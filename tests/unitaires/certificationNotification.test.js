/**
 * La réponse à une demande de certification : e-mail ET notification.
 *
 * L'e-mail reste — c'est la trace écrite d'une décision administrative sur
 * un compte, et en cas de refus il porte le motif. La notification s'y
 * ajoute : le vendeur qui n'ouvre pas sa boîte mail doit l'apprendre quand
 * même, et tout de suite.
 *
 * Le push partait déjà, par `creerNotification`. Ce qui manquait, c'est de
 * quoi ouvrir le bon écran : la notification ne portait AUCUN identifiant —
 * ni commande, ni boutique — et le téléphone la faisait donc retomber sur la
 * messagerie. Le vendeur à qui on écrivait « vous pouvez renvoyer vos
 * photos » atterrissait dans ses conversations. `certification` dans les
 * données règle cela ; le mobile le lit dans `destinationNotification`.
 */

const mockCreerNotification = jest.fn(async () => ({}));
const mockEmailCertification = jest.fn(async () => ({}));
const mockUpdate = jest.fn(async () => {});

jest.mock('../../src/services/notifications/notification.service', () => ({
  creerNotification: (...a) => mockCreerNotification(...a),
}));
jest.mock('../../src/services/resend.service', () => ({
  sendCertificationEmail: (...a) => mockEmailCertification(...a),
  sendAccesUtilisateurEmail: jest.fn(),
}));

const mockVendeur = {
  id: 'vendeur-1',
  prenom: 'Alioune',
  nom: 'Ndiaye',
  email: 'alioune@exemple.sn',
  role: 'Vendeur',
  update: (...a) => mockUpdate(...a),
};

jest.mock('../../src/models', () => ({
  Utilisateur: { findOne: jest.fn(), findAll: jest.fn(), findByPk: jest.fn() },
  Boutique: { findOne: jest.fn(async () => ({ nom: 'Chez Awa' })) },
  Produit: {},
  Commande: {},
  Abonnement: { create: jest.fn() },
  Categorie: {},
  Avis: {},
  Signalement: {},
  Paiement: {},
  Favori: {},
  Notification: {},
  Message: {},
  LigneCommande: {},
  AuditLog: {},
  Permission: {},
  Menu: {},
  DemandeRetour: {},
  ConfigApp: {},
  PreferenceClient: {},
  QuestionFrequente: {},
  MessageSite: {},
  VisiteBoutique: {},
  HistoriqueCommande: {},
}));
jest.mock('../../src/config/db', () => ({
  transaction: jest.fn(async () => ({ commit: jest.fn(), rollback: jest.fn() })),
  define: jest.fn(() => ({})),
  fn: jest.fn(),
  col: jest.fn(),
  literal: jest.fn(),
  query: jest.fn(),
}));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const { Utilisateur } = require('../../src/models');
const AdminService = require('../../src/services/admin/admin.service');

const vider = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  jest.clearAllMocks();
  Utilisateur.findOne.mockResolvedValue(mockVendeur);
});

describe('Certification approuvée', () => {
  test('le vendeur reçoit l’e-mail ET la notification', async () => {
    await AdminService.validerProfilVendeur('vendeur-1', 'admin-1');
    await vider();

    expect(mockEmailCertification).toHaveBeenCalledTimes(1);
    expect(mockEmailCertification.mock.calls[0][0].approuvee).toBe(true);
    expect(mockCreerNotification).toHaveBeenCalledTimes(1);
  });

  test('la notification mène à l’écran de certification', async () => {
    await AdminService.validerProfilVendeur('vendeur-1', 'admin-1');
    await vider();

    const envoi = mockCreerNotification.mock.calls[0][0];
    expect(envoi.utilisateurId).toBe('vendeur-1');
    expect(envoi.data.certification).toBe('approuve');
  });
});

describe('Certification refusée', () => {
  test('l’e-mail et la notification portent tous deux le motif', async () => {
    await AdminService.rejeterProfilVendeur('vendeur-1', 'admin-1', 'Photo illisible');
    await vider();

    expect(mockEmailCertification.mock.calls[0][0].motif).toBe('Photo illisible');
    expect(mockCreerNotification.mock.calls[0][0].message).toContain('Photo illisible');
  });

  test('la notification mène à l’écran où renvoyer ses photos', async () => {
    // C'est ici que l'écran visé compte le plus : le message dit « vous
    // pouvez renvoyer vos photos », il faut que le toucher y mène.
    await AdminService.rejeterProfilVendeur('vendeur-1', 'admin-1', 'Pièce expirée');
    await vider();

    expect(mockCreerNotification.mock.calls[0][0].data.certification).toBe('rejete');
  });

  test('un refus sans motif est refusé avant toute notification', async () => {
    await expect(
      AdminService.rejeterProfilVendeur('vendeur-1', 'admin-1', '   '),
    ).rejects.toThrow();

    expect(mockCreerNotification).not.toHaveBeenCalled();
    expect(mockEmailCertification).not.toHaveBeenCalled();
  });
});

describe('Vendeur introuvable', () => {
  test('rien n’est envoyé', async () => {
    Utilisateur.findOne.mockResolvedValue(null);

    await expect(
      AdminService.validerProfilVendeur('inconnu', 'admin-1'),
    ).rejects.toThrow();

    expect(mockCreerNotification).not.toHaveBeenCalled();
    expect(mockEmailCertification).not.toHaveBeenCalled();
  });
});
