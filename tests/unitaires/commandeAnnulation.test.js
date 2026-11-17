/**
 * Les règles d'annulation d'une commande.
 *
 * Trois decisions metier, prises apres audit :
 *   1. une commande PAYEE ne s'annule plus — elle passait auparavant en
 *      « remboursé » sans qu'aucun argent ne bouge ;
 *   2. une commande EN PREPARATION ne s'annule plus seule — le vendeur a
 *      engage du travail, il accepte ou refuse ;
 *   3. une commande ne se SUPPRIME jamais (voir adminCommande.test.js).
 *
 * S'y ajoute le verrou : deux annulations simultanees restauraient toutes
 * deux le stock.
 */

const mockFindByPk = jest.fn();
const mockHistorique = jest.fn().mockResolvedValue(undefined);
const mockRestaurer = jest.fn();

/** Transaction factice, utilisable dans les deux formes de l'API Sequelize. */
function fausseTransaction() {
  return {
    LOCK: { UPDATE: 'UPDATE' },
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };
}
let mockTransactionCourante;

jest.mock('../../src/models', () => ({
  Commande: { findByPk: (...a) => mockFindByPk(...a) },
  HistoriqueCommande: { create: (...a) => mockHistorique(...a) },
  LigneCommande: { findAll: jest.fn().mockResolvedValue([]) },
  Produit: {},
  Utilisateur: { findByPk: jest.fn().mockResolvedValue(null) },
  Boutique: { findOne: jest.fn().mockResolvedValue(null) },
}));
jest.mock('../../src/config/db', () => ({
  // `transaction()` nu rend la transaction ; `transaction(cb)` l'exécute.
  transaction: (cb) => (cb ? cb(mockTransactionCourante) : Promise.resolve(mockTransactionCourante)),
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

const CommandeService = require('../../src/services/commandes/commande.service');

const ACHETEUR = 'acheteur-1';
const VENDEUR = 'vendeur-1';

function commande(modifs = {}) {
  return {
    id: 'cmd-1',
    referenceCommande: 'CMD-2026-TEST',
    statut: 'acceptee',
    statutPaiement: 'non_paye',
    modePaiement: 'a_la_livraison',
    acheteurId: ACHETEUR,
    vendeurId: VENDEUR,
    stockDecremente: false,
    annulationDemandeeLe: null,
    annulationMotif: null,
    annulationRefusMotif: null,
    save: jest.fn().mockResolvedValue(undefined),
    ...modifs,
  };
}

/** Le service lit deux fois : une fois nu, une fois sous verrou. */
function enBase(c) {
  mockFindByPk.mockResolvedValue(c);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTransactionCourante = fausseTransaction();
  CommandeService._restaurerStock = mockRestaurer.mockResolvedValue(undefined);
});

describe('Une commande payée ne s’annule plus', () => {
  test('l’acheteur est renvoyé vers la procédure de retour', async () => {
    enBase(commande({ statut: 'payee', statutPaiement: 'paye' }));

    await expect(
      CommandeService.annulerCommande('cmd-1', ACHETEUR)
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/pay.e.*retour/is),
    });
  });

  test('le point de passage lui-même refuse, quelle que soit l’origine', async () => {
    // _annuler est le seul chemin : acheteur, vendeur et administration y
    // aboutissent tous. La garde est donc posée là, pas seulement en amont.
    enBase(commande({ statut: 'confirmee', statutPaiement: 'paye' }));

    await expect(
      CommandeService._annuler(commande({ statutPaiement: 'paye' }), 'vendeur')
    ).rejects.toMatchObject({ status: 400 });
  });

  test('le statut de paiement n’est jamais mis à « remboursé »', async () => {
    const c = commande({ statut: 'payee', statutPaiement: 'paye' });
    enBase(c);

    await CommandeService.annulerCommande('cmd-1', ACHETEUR).catch(() => {});

    expect(c.statutPaiement).toBe('paye');
    expect(c.save).not.toHaveBeenCalled();
  });
});

describe('Une commande en préparation se demande, ne s’annule pas', () => {
  test('l’annulation directe est refusée', async () => {
    enBase(commande({ statut: 'en_preparation' }));

    await expect(
      CommandeService.annulerCommande('cmd-1', ACHETEUR)
    ).rejects.toMatchObject({
      message: expect.stringMatching(/pr.paration.*demandez/is),
    });
  });

  test('la demande enregistre son motif et sa date', async () => {
    const c = commande({ statut: 'en_preparation' });
    enBase(c);

    await CommandeService.demanderAnnulation('cmd-1', ACHETEUR, '  Je pars en voyage  ');

    expect(c.annulationMotif).toBe('Je pars en voyage');
    expect(c.annulationDemandeeLe).toBeInstanceOf(Date);
    expect(c.save).toHaveBeenCalled();
  });

  test('une demande sans motif est refusée', async () => {
    enBase(commande({ statut: 'en_preparation' }));
    await expect(
      CommandeService.demanderAnnulation('cmd-1', ACHETEUR, '   ')
    ).rejects.toMatchObject({ status: 400 });
  });

  test('deux demandes de suite : la seconde est refusée', async () => {
    enBase(commande({ statut: 'en_preparation', annulationDemandeeLe: new Date() }));
    await expect(
      CommandeService.demanderAnnulation('cmd-1', ACHETEUR, 'encore')
    ).rejects.toMatchObject({ message: expect.stringMatching(/d.j..*attente/is) });
  });

  test('on ne demande pas l’annulation d’une commande déjà prête', async () => {
    enBase(commande({ statut: 'prete' }));
    await expect(
      CommandeService.demanderAnnulation('cmd-1', ACHETEUR, 'trop tard')
    ).rejects.toMatchObject({ status: 400 });
  });

  test('la commande d’un autre acheteur reste inaccessible', async () => {
    enBase(commande({ statut: 'en_preparation' }));
    await expect(
      CommandeService.demanderAnnulation('cmd-1', 'quelqu-un-dautre', 'tiens')
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('Le vendeur répond à la demande', () => {
  test('accepter annule la commande', async () => {
    const c = commande({ statut: 'en_preparation', annulationDemandeeLe: new Date() });
    enBase(c);

    const rendu = await CommandeService.repondreDemandeAnnulation('cmd-1', VENDEUR, {
      accepte: true,
    });

    expect(rendu.statut).toBe('annulee');
    expect(mockRestaurer).toHaveBeenCalled();
  });

  test('refuser referme la demande et garde le motif lisible', async () => {
    const c = commande({ statut: 'en_preparation', annulationDemandeeLe: new Date() });
    enBase(c);

    await CommandeService.repondreDemandeAnnulation('cmd-1', VENDEUR, {
      accepte: false,
      motif: 'Déjà emballée',
    });

    expect(c.annulationDemandeeLe).toBeNull();
    expect(c.annulationRefusMotif).toBe('Déjà emballée');
    expect(c.statut).toBe('en_preparation');
  });

  test('répondre sans demande en attente est refusé', async () => {
    enBase(commande({ statut: 'en_preparation' }));
    await expect(
      CommandeService.repondreDemandeAnnulation('cmd-1', VENDEUR, { accepte: true })
    ).rejects.toMatchObject({ message: expect.stringMatching(/aucune demande/i) });
  });

  test('un autre vendeur ne répond pas à sa place', async () => {
    enBase(commande({ statut: 'en_preparation', annulationDemandeeLe: new Date() }));
    await expect(
      CommandeService.repondreDemandeAnnulation('cmd-1', 'autre-vendeur', { accepte: true })
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('Deux annulations simultanées', () => {
  test('la seconde ne restaure pas le stock une deuxième fois', async () => {
    // La première a déjà abouti : la relecture SOUS VERROU voit « annulee ».
    // Sans ce verrou, les deux lisaient `stockDecremente = true` et rendaient
    // chacune les quantités — le stock gonflait d'autant.
    enBase(commande({ statut: 'annulee', stockDecremente: false }));

    const rendu = await CommandeService._annuler(
      commande({ statut: 'en_attente' }),
      'acheteur',
    );

    expect(rendu.statut).toBe('annulee');
    expect(mockRestaurer).not.toHaveBeenCalled();
    expect(mockTransactionCourante.rollback).toHaveBeenCalled();
    expect(mockTransactionCourante.commit).not.toHaveBeenCalled();
  });

  test('la commande est relue sous verrou dans la transaction', async () => {
    enBase(commande({ statut: 'acceptee' }));

    await CommandeService._annuler(commande(), 'acheteur');

    const [, options] = mockFindByPk.mock.calls.at(-1);
    expect(options).toMatchObject({ lock: 'UPDATE' });
    expect(options.transaction).toBe(mockTransactionCourante);
  });
});

describe('Une commande ne se supprime jamais', () => {
  test('le service d’administration refuse, et dit quoi faire', async () => {
    // Avant : `destroy()` — suppression physique, le modele n'etant pas
    // `paranoid` — refusee seulement si la commande etait payee. Une commande
    // livree non reglee, ou deja annulee, disparaissait avec ses lignes.
    jest.resetModules();
    jest.doMock('../../src/models', () => ({
      Commande: { findByPk: async () => ({ id: 'cmd-1', statut: 'livree', destroy: jest.fn() }) },
      LigneCommande: {}, Produit: {}, Utilisateur: {}, Boutique: {},
      Categorie: {}, Avis: {}, Favori: {}, Paiement: {}, Abonnement: {},
    }));
    const Admin = require('../../src/services/admin/adminCatalogue.service');

    await expect(Admin.supprimerCommande('cmd-1')).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/ne se supprime pas/i),
    });
  });
});

describe('Historique : chaque operation laisse une trace', () => {
  test('une annulation note qui, quand, depuis quel etat, et pourquoi', async () => {
    enBase(commande({ statut: 'acceptee' }));

    await CommandeService.annulerCommande('cmd-1', ACHETEUR, 'Je me suis trompe');

    expect(mockHistorique).toHaveBeenCalledWith(
      expect.objectContaining({
        commandeId: 'cmd-1',
        auteurId: ACHETEUR,
        auteurRole: 'acheteur',
        operation: 'annulation',
        statutAvant: 'acceptee',
        statutApres: 'annulee',
        motif: 'Je me suis trompe',
      })
    );
  });

  test('une demande d’annulation aussi', async () => {
    enBase(commande({ statut: 'en_preparation' }));

    await CommandeService.demanderAnnulation('cmd-1', ACHETEUR, 'Trop long');

    expect(mockHistorique).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'demande_annulation',
        auteurRole: 'acheteur',
        motif: 'Trop long',
      })
    );
  });

  test('un refus note son motif et son auteur', async () => {
    enBase(commande({ statut: 'en_preparation', annulationDemandeeLe: new Date() }));

    await CommandeService.repondreDemandeAnnulation('cmd-1', VENDEUR, {
      accepte: false,
      motif: 'Deja emballee',
    });

    expect(mockHistorique).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'reponse_annulation',
        auteurId: VENDEUR,
        auteurRole: 'vendeur',
        motif: 'Deja emballee',
      })
    );
  });

  test('le journal ne fait jamais echouer l’operation reelle', async () => {
    // Il suit une transaction deja validee : une commande annulee ne doit pas
    // se desannuler parce que le journal est indisponible.
    mockHistorique.mockRejectedValueOnce(new Error('base indisponible'));
    enBase(commande({ statut: 'acceptee' }));

    const rendu = await CommandeService.annulerCommande('cmd-1', ACHETEUR, 'peu importe');
    expect(rendu.statut).toBe('annulee');
  });
});

describe('Le stock ne sort jamais deux fois', () => {
  test('_decrementerStock se refuse lui-meme sur une commande deja engagee', async () => {
    // Les trois appelants posaient la garde chacun de leur cote ; un
    // quatrieme, distrait, sortait le stock une deuxieme fois.
    const c = commande({ stockDecremente: true });

    await CommandeService._decrementerStock(c, mockTransactionCourante);

    // Elle sort immediatement : rien n'est relu, rien n'est reecrit.
    expect(c.save).not.toHaveBeenCalled();
    expect(c.stockDecremente).toBe(true);
  });

  test('elle agit normalement quand le stock n’est pas encore sorti', async () => {
    const c = commande({ stockDecremente: false });

    await CommandeService._decrementerStock(c, mockTransactionCourante);

    expect(c.stockDecremente).toBe(true);
    expect(c.save).toHaveBeenCalled();
  });
});
