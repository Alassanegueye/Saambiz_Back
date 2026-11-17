/**
 * L'administration corrige une commande, SANS SORTIR DU WORKFLOW.
 *
 * Elle s'en affranchissait complètement : aucun appel à la table des
 * transitions, donc `en_attente → livree` passait d'un trait sur une commande
 * que personne n'avait préparée ni expédiée. Et `statutPaiement` s'écrivait à
 * la main — un administrateur pouvait déclarer « payé » sans le moindre
 * encaissement, ou « remboursé » sans remboursement.
 */

const mockFindByPk = jest.fn();
const mockSave = jest.fn();
const mockHistorique = jest.fn().mockResolvedValue(undefined);
const mockTransaction = {
  LOCK: { UPDATE: 'UPDATE' },
  commit: jest.fn(),
  rollback: jest.fn(),
};

jest.mock('../../src/models', () => ({
  Commande: { findByPk: (...a) => mockFindByPk(...a) },
  HistoriqueCommande: { create: (...a) => mockHistorique(...a) },
  LigneCommande: { findAll: jest.fn().mockResolvedValue([]) },
  Produit: {},
  Utilisateur: {},
  Boutique: {},
  Categorie: {},
  Avis: {},
  Favori: {},
  Paiement: {},
  Abonnement: {},
  ProduitImage: {},
}));
jest.mock('../../src/config/db', () => ({
  transaction: (cb) => (cb ? cb(mockTransaction) : Promise.resolve(mockTransaction)),
  define: jest.fn(() => ({})),
}));
jest.mock('../../src/services/notifications/notification.service', () => ({
  creerNotification: jest.fn(),
  notifierUtilisateurs: jest.fn(),
  notifierAbonnesBoutique: jest.fn(),
}));
jest.mock('../../src/services/resend.service', () => ({
  sendNouvelleCommandeEmail: jest.fn(),
  sendCommandeClientEmail: jest.fn(),
}));
jest.mock('../../src/services/socket.service', () => ({
  getIO: () => ({ to: () => ({ emit: jest.fn() }) }),
}));

const Admin = require('../../src/services/admin/adminCatalogue.service');

const ADMIN = 'admin-1';

function commande(modifs = {}) {
  return {
    id: 'cmd-1',
    referenceCommande: 'CMD-2026-TEST',
    statut: 'en_attente',
    statutPaiement: 'non_paye',
    modePaiement: 'a_la_livraison',
    modeLivraison: 'retrait',
    acheteurId: 'acheteur-1',
    vendeurId: 'vendeur-1',
    stockDecremente: false,
    annulationDemandeeLe: null,
    save: mockSave,
    ...modifs,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSave.mockResolvedValue(undefined);
  mockHistorique.mockResolvedValue(undefined);
});

describe('La table des transitions s’applique aussi à l’administration', () => {
  test('en attente → livrée est refusé, et le message dit ce qui est possible', async () => {
    mockFindByPk.mockResolvedValue(commande({ statut: 'en_attente' }));

    await expect(
      Admin.modifierCommande('cmd-1', { statut: 'livree' }, ADMIN)
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/ne peut pas passer.*Transitions possibles/s),
    });
  });

  test('une transition prévue passe', async () => {
    mockFindByPk.mockResolvedValue(commande({ statut: 'en_preparation' }));
    Admin.detailCommande = jest.fn().mockResolvedValue({ commande: {} });

    await Admin.modifierCommande('cmd-1', { statut: 'prete' }, ADMIN);

    expect(mockSave).toHaveBeenCalled();
  });

  test('une commande livrée ne revient pas en préparation', async () => {
    mockFindByPk.mockResolvedValue(commande({ statut: 'livree' }));

    await expect(
      Admin.modifierCommande('cmd-1', { statut: 'en_preparation' }, ADMIN)
    ).rejects.toMatchObject({ status: 400 });
  });

  test('une commande annulée n’est pas relancée', async () => {
    mockFindByPk.mockResolvedValue(commande({ statut: 'annulee' }));

    await expect(
      Admin.modifierCommande('cmd-1', { statut: 'acceptee' }, ADMIN)
    ).rejects.toMatchObject({ message: expect.stringMatching(/annul.e.*relanc/is) });
  });
});

describe('Le statut de paiement ne s’écrit plus à la main', () => {
  test('déclarer « payé » est refusé', async () => {
    mockFindByPk.mockResolvedValue(commande({ statutPaiement: 'non_paye' }));

    await expect(
      Admin.modifierCommande('cmd-1', { statutPaiement: 'paye' }, ADMIN)
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/encaissement r.el/i),
    });
  });

  test('déclarer « remboursé » est refusé aussi', async () => {
    mockFindByPk.mockResolvedValue(commande({ statutPaiement: 'paye' }));

    await expect(
      Admin.modifierCommande('cmd-1', { statutPaiement: 'rembourse' }, ADMIN)
    ).rejects.toMatchObject({ status: 400 });
  });

  test('renvoyer la valeur inchangée ne bloque rien', async () => {
    // Un back-office qui réenvoie tout le formulaire ne doit pas être puni
    // pour avoir inclus un champ qu'il n'a pas touché.
    mockFindByPk.mockResolvedValue(commande({ statut: 'acceptee', statutPaiement: 'non_paye' }));
    Admin.detailCommande = jest.fn().mockResolvedValue({ commande: {} });

    await expect(
      Admin.modifierCommande('cmd-1', { statutPaiement: 'non_paye', note: 'rappeler' }, ADMIN)
    ).resolves.toBeDefined();
  });
});

describe('Ce que l’administration fait reste tracé', () => {
  test('le changement de statut note l’admin, l’avant et l’après', async () => {
    mockFindByPk.mockResolvedValue(commande({ statut: 'en_preparation' }));
    Admin.detailCommande = jest.fn().mockResolvedValue({ commande: {} });

    await Admin.modifierCommande('cmd-1', { statut: 'prete', motif: 'Erreur de saisie' }, ADMIN);

    expect(mockHistorique).toHaveBeenCalledWith(
      expect.objectContaining({
        auteurId: ADMIN,
        auteurRole: 'admin',
        operation: 'statut',
        statutAvant: 'en_preparation',
        statutApres: 'prete',
        motif: 'Erreur de saisie',
      })
    );
  });
});

describe('Une commande ne se supprime jamais', () => {
  test('le refus est explicite et dit quoi faire', async () => {
    mockFindByPk.mockResolvedValue(commande({ statut: 'livree' }));

    await expect(Admin.supprimerCommande('cmd-1')).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/ne se supprime pas/i),
    });
  });

  test('même une commande déjà annulée est conservée', async () => {
    mockFindByPk.mockResolvedValue(commande({ statut: 'annulee' }));

    await expect(Admin.supprimerCommande('cmd-1')).rejects.toMatchObject({
      message: expect.stringMatching(/d.j. annul.e/i),
    });
  });
});
