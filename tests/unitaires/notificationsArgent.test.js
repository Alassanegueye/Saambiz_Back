/**
 * Les quatre silences qui touchaient à l'argent.
 *
 *  - un paiement refusé : la commande restait « en attente » sans un mot, et
 *    le client ne savait pas si son argent était parti ni s'il devait
 *    recommencer ;
 *  - une demande de retour : personne ne prévenait le vendeur, qui apprenait
 *    le retour de sa marchandise en la voyant revenir ;
 *  - un abonnement expiré : rappel à sept jours, rappel à trois, puis plus
 *    rien — le vendeur découvrait sa boutique bloquée en essayant de vendre ;
 *  - un stock tombé à zéro : le produit passait hors ligne en silence, et le
 *    vendeur continuait de croire qu'il vendait.
 */

const mockCreerNotification = jest.fn(async () => ({}));
const mockAbonnementFindAll = jest.fn();
const mockAbonnementUpdate = jest.fn(async () => [0]);
const mockDemandeCreate = jest.fn();
const mockDemandeFindOne = jest.fn();
const mockCommandeFindByPk = jest.fn();
const mockUtilisateurFindByPk = jest.fn();

jest.mock('../../src/services/notifications/notification.service', () => ({
  creerNotification: (...a) => mockCreerNotification(...a),
}));
jest.mock('../../src/services/resend.service', () => ({
  sendAbonnementExpiration: jest.fn(async () => ({})),
  sendAbonnementConfirme: jest.fn(async () => ({})),
}));
jest.mock('../../src/models', () => ({
  Abonnement: {
    findAll: (...a) => mockAbonnementFindAll(...a),
    update: (...a) => mockAbonnementUpdate(...a),
  },
  DemandeRetour: {
    create: (...a) => mockDemandeCreate(...a),
    findOne: (...a) => mockDemandeFindOne(...a),
  },
  Commande: { findByPk: (...a) => mockCommandeFindByPk(...a) },
  Utilisateur: { findByPk: (...a) => mockUtilisateurFindByPk(...a) },
  Boutique: { findOne: jest.fn() },
  Paiement: {},
}));
jest.mock('../../src/config/db', () => ({
  transaction: jest.fn(), define: jest.fn(() => ({})),
  fn: jest.fn(), col: jest.fn(), literal: jest.fn(),
}));
jest.mock('../../src/services/notifications/notification.service.js', () => ({
  creerNotification: (...a) => mockCreerNotification(...a),
}));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const expireAbonnements = require('../../src/jobs/abonnement.job');
const DemandeRetourService = require('../../src/services/commandes/demandeRetour.service');

const vider = () => new Promise((r) => setImmediate(r));
const envoi = (i = 0) => mockCreerNotification.mock.calls[i][0];

beforeEach(() => {
  jest.clearAllMocks();
  mockAbonnementFindAll.mockResolvedValue([]);
  mockUtilisateurFindByPk.mockResolvedValue({ prenom: 'Moussa', nom: 'Ndiaye' });
  mockDemandeFindOne.mockResolvedValue(null);
  mockDemandeCreate.mockResolvedValue({ id: 'ret-1' });
  mockCommandeFindByPk.mockResolvedValue({
    id: 'cmd-1',
    referenceCommande: 'CMD-2026-LREV6T',
    acheteurId: 'acheteur-1',
    vendeurId: 'vendeur-1',
    statut: 'livree',
  });
});

describe('Abonnement expiré, le jour même', () => {
  test('le vendeur l’apprend, au lieu de le découvrir en vendant', async () => {
    // Le premier appel du job lit les abonnements échus, le second cherche
    // ceux qui approchent de l'échéance.
    mockAbonnementFindAll
      .mockResolvedValueOnce([
        { id: 'abo-1', utilisateur: { id: 'vendeur-1', role: 'Vendeur' } },
      ])
      .mockResolvedValue([]);

    await expireAbonnements();
    await vider();

    expect(mockCreerNotification).toHaveBeenCalledTimes(1);
    expect(envoi().utilisateurId).toBe('vendeur-1');
    expect(envoi().titre).toContain('expiré');
    expect(envoi().type).toBe('abonnement');
    expect(envoi().data.abonnementId).toBe('abo-1');
  });

  test('un acheteur échu n’est pas concerné', async () => {
    mockAbonnementFindAll
      .mockResolvedValueOnce([
        { id: 'abo-2', utilisateur: { id: 'acheteur-1', role: 'Acheteur' } },
      ])
      .mockResolvedValue([]);

    await expireAbonnements();
    await vider();

    expect(mockCreerNotification).not.toHaveBeenCalled();
  });

  test('les abonnements sont bien passés à « expiré »', async () => {
    // La lecture préalable ne doit pas avoir remplacé la mise à jour.
    await expireAbonnements();

    expect(mockAbonnementUpdate).toHaveBeenCalledWith(
      { statut: 'expire' },
      expect.any(Object),
    );
  });
});

describe('Demande de retour', () => {
  test('le vendeur est prévenu, avec la référence et le motif', async () => {
    await DemandeRetourService.creerDemande('cmd-1', 'acheteur-1', 'Taille trop petite');
    await vider();

    expect(envoi().utilisateurId).toBe('vendeur-1');
    expect(envoi().message).toContain('CMD-2026-LREV6T');
    expect(envoi().message).toContain('Taille trop petite');
    expect(envoi().data.commandeId).toBe('cmd-1');
    expect(envoi().data.pourVendeur).toBe(true);
  });

  test('une commande non livrée ne crée rien, et ne notifie rien', async () => {
    mockCommandeFindByPk.mockResolvedValue({
      id: 'cmd-1', acheteurId: 'acheteur-1', vendeurId: 'vendeur-1', statut: 'en_preparation',
    });

    await expect(
      DemandeRetourService.creerDemande('cmd-1', 'acheteur-1', 'Trop petite'),
    ).rejects.toThrow();
    expect(mockCreerNotification).not.toHaveBeenCalled();
  });

  test('une seconde demande en attente est refusée sans notifier', async () => {
    mockDemandeFindOne.mockResolvedValue({ id: 'ret-0' });

    await expect(
      DemandeRetourService.creerDemande('cmd-1', 'acheteur-1', 'Trop petite'),
    ).rejects.toThrow();
    expect(mockCreerNotification).not.toHaveBeenCalled();
  });
});
