/**
 * Tant que Wave et Orange Money ne sont pas branchés, tout se règle dehors.
 *
 * Et c'est le vendeur qui doit pouvoir l'acter. Le serveur REFUSAIT qu'il
 * confirme avoir été payé sur une commande marquée « en ligne » :
 *
 *   « Cette commande se règle en ligne : son paiement est confirmé
 *     automatiquement. »
 *
 * Automatiquement par quoi ? Par une passerelle qui n'existe pas. Le client
 * payait par Wave de la main à la main, et la commande restait « non payée »
 * POUR TOUJOURS — personne, ni le client ni le vendeur, ne pouvait la
 * solder.
 *
 * Un seul interrupteur gouverne les trois comportements :
 * `PAIEMENT_EN_LIGNE_ACTIF`. Faux aujourd'hui.
 */

const mockFindByPk = jest.fn();
const mockTransaction = jest.fn();

jest.mock('../../src/models', () => ({
  Commande: { findByPk: (...a) => mockFindByPk(...a) },
  LigneCommande: { findAll: jest.fn(async () => []) },
  Produit: {},
  Utilisateur: { findByPk: jest.fn(async () => null) },
  Boutique: { findOne: jest.fn(async () => null) },
  HistoriqueCommande: { create: jest.fn(async () => ({})) },
}));
jest.mock('../../src/config/db', () => ({
  transaction: (...a) => mockTransaction(...a),
  define: jest.fn(() => ({})),
}));
jest.mock('../../src/services/socket.service', () => ({
  getIO: () => ({ to: () => ({ emit: jest.fn() }) }),
}));
jest.mock('../../src/services/notifications/notification.service', () => ({
  creerNotification: jest.fn(async () => ({})),
  notifierUtilisateurs: jest.fn(),
  notifierAbonnesBoutique: jest.fn(),
}));
jest.mock('../../src/services/resend.service', () => ({
  sendCommandeClientEmail: jest.fn(),
  sendNouvelleCommandeEmail: jest.fn(),
}));

const { paiementEnLigneActif } = require('../../src/config/security');
const CommandeService = require('../../src/services/commandes/commande.service');

/** Une commande acceptée, pas encore payée. */
function commande(modePaiement) {
  return {
    id: 'cmd-1',
    referenceCommande: 'CMD-2026-CAXV47',
    vendeurId: 'vendeur-1',
    acheteurId: 'acheteur-1',
    statut: 'acceptee',
    statutPaiement: 'non_paye',
    modePaiement,
    montantTotal: '5500.00',
    save: jest.fn(async () => {}),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // La relecture sous verrou, à l'intérieur de la transaction.
  mockTransaction.mockImplementation(async (fn) => fn({ LOCK: { UPDATE: 'UPDATE' } }));
});

describe('L’interrupteur', () => {
  test('le paiement en ligne est fermé par défaut', () => {
    // Sans PAIEMENT_EN_LIGNE_ACTIF=true dans l'environnement.
    expect(paiementEnLigneActif).toBe(false);
  });
});

describe('Le vendeur confirme avoir été payé', () => {
  test('sur une commande « à la réception » : accepté, comme avant', async () => {
    const c = commande('a_la_livraison');
    mockFindByPk.mockResolvedValue(c);

    await expect(
      CommandeService.confirmerPaiementVendeur('cmd-1', 'vendeur-1'),
    ).resolves.toBeDefined();
  });

  test('sur une commande « en ligne » : accepté aussi, tant que c’est fermé', async () => {
    // LE CAS DE LA CAPTURE : CMD-2026-CAXV47, acceptée, en ligne, non payée.
    // Le client paie par Wave de la main à la main ; sans cela, le vendeur
    // n'avait aucun moyen de le constater.
    const c = commande('en_ligne');
    mockFindByPk.mockResolvedValue(c);

    await expect(
      CommandeService.confirmerPaiementVendeur('cmd-1', 'vendeur-1'),
    ).resolves.toBeDefined();
  });

  test('la commande d’un autre vendeur reste refusée', async () => {
    // Ce qu'on ouvre, c'est le mode de paiement — pas la propriété.
    mockFindByPk.mockResolvedValue(commande('en_ligne'));

    await expect(
      CommandeService.confirmerPaiementVendeur('cmd-1', 'un-autre'),
    ).rejects.toThrow(/ne vous appartient pas/i);
  });

  test('une commande annulée reste refusée', async () => {
    mockFindByPk.mockResolvedValue({ ...commande('en_ligne'), statut: 'annulee' });

    await expect(
      CommandeService.confirmerPaiementVendeur('cmd-1', 'vendeur-1'),
    ).rejects.toThrow(/annulée/i);
  });

  test('une commande pas encore acceptée reste refusée', async () => {
    mockFindByPk.mockResolvedValue({ ...commande('en_ligne'), statut: 'en_attente' });

    await expect(
      CommandeService.confirmerPaiementVendeur('cmd-1', 'vendeur-1'),
    ).rejects.toThrow(/Acceptez d'abord/i);
  });
});

describe('Le message d’acceptation envoyé au client', () => {
  test('ne renvoie plus vers un écran de paiement qui n’aboutit pas', async () => {
    // Il disait : « Ouvrez Mes commandes pour la payer par Wave ou Orange
    // Money. » Le client ouvrait, et tombait sur une feuille sans suite.
    const message = CommandeService._messageAcceptation(commande('en_ligne'));

    expect(message).not.toMatch(/Wave|Orange Money/i);
    expect(message).toMatch(/directement avec la boutique/i);
  });

  test('et dit la même chose pour une commande à la réception', async () => {
    const message = CommandeService._messageAcceptation(commande('a_la_livraison'));

    expect(message).toMatch(/directement avec la boutique/i);
  });
});
