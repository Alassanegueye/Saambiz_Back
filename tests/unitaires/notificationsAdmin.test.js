/**
 * Les décisions de l'administration se disent.
 *
 * Elles se prenaient toutes en silence : un produit retiré, un compte
 * suspendu, un site coupé, un signalement classé. La personne le découvrait
 * en butant dessus — un vendeur qui attend des ventes sur une fiche que
 * personne ne voit plus, quelqu'un qui n'arrive plus à se connecter sans
 * savoir pourquoi, un client dont « Mes signalements » affiche « en attente »
 * des mois après la décision.
 *
 * Chacune porte maintenant le nom de l'écran à ouvrir, parce qu'aucune ne
 * transporte d'identifiant qui le désignerait.
 */

const mockCreerNotification = jest.fn(async () => ({}));
const mockUtilisateurFindOne = jest.fn();
const mockProduitFindByPk = jest.fn();
const mockBoutiqueFindByPk = jest.fn();
const mockSignalementFindByPk = jest.fn();

jest.mock('../../src/services/notifications/notification.service', () => ({
  creerNotification: (...a) => mockCreerNotification(...a),
}));
jest.mock('../../src/services/resend.service', () => ({
  sendCertificationEmail: jest.fn(async () => ({})),
  sendAccesUtilisateurEmail: jest.fn(),
}));
jest.mock('../../src/models', () => ({
  Utilisateur: { findOne: (...a) => mockUtilisateurFindOne(...a), findAll: jest.fn(), findByPk: jest.fn() },
  Produit: { findByPk: (...a) => mockProduitFindByPk(...a) },
  Boutique: { findByPk: (...a) => mockBoutiqueFindByPk(...a), findOne: jest.fn() },
  Signalement: { findByPk: (...a) => mockSignalementFindByPk(...a) },
  Commande: {}, Abonnement: {}, Categorie: {}, Avis: {}, Paiement: {}, Favori: {},
  Notification: {}, Message: {}, LigneCommande: {}, AuditLog: {}, Permission: {},
  Menu: {}, DemandeRetour: {}, ConfigApp: {}, PreferenceClient: {},
  QuestionFrequente: {}, MessageSite: {}, VisiteBoutique: {}, HistoriqueCommande: {},
}));
jest.mock('../../src/config/db', () => ({
  transaction: jest.fn(async () => ({ commit: jest.fn(), rollback: jest.fn() })),
  define: jest.fn(() => ({})),
  fn: jest.fn(), col: jest.fn(), literal: jest.fn(), query: jest.fn(),
}));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const AdminService = require('../../src/services/admin/admin.service');

const vider = () => new Promise((r) => setImmediate(r));
const envoi = () => mockCreerNotification.mock.calls[0][0];

const compte = (id, role) => ({ id, role, update: jest.fn(async () => {}) });

beforeEach(() => {
  jest.clearAllMocks();
  mockUtilisateurFindOne.mockResolvedValue(compte('vendeur-1', 'Vendeur'));
  mockProduitFindByPk.mockResolvedValue({
    id: 'prod-1', nom: 'Robe wax', vendeurId: 'vendeur-1', update: jest.fn(async () => {}),
  });
  mockSignalementFindByPk.mockResolvedValue({
    id: 'sig-1', signaleurId: 'acheteur-1', update: jest.fn(async () => {}),
  });
});

describe('Modération d’un produit', () => {
  test('un refus est dit au vendeur, avec le nom du produit', async () => {
    await AdminService.rejeterProduit('prod-1');
    await vider();

    expect(envoi().utilisateurId).toBe('vendeur-1');
    expect(envoi().message).toContain('Robe wax');
    expect(envoi().data.ecran).toBe('mes_produits');
  });

  test('une approbation aussi : la bonne nouvelle compte autant', async () => {
    await AdminService.approuverProduit('prod-1');
    await vider();

    expect(envoi().titre).toContain('approuvé');
    expect(envoi().data.ecran).toBe('mes_produits');
  });
});

describe('Suspension d’un compte', () => {
  test('le vendeur l’apprend autrement qu’en ne pouvant plus se connecter', async () => {
    await AdminService.suspendreVendeur('vendeur-1');
    await vider();

    expect(envoi().utilisateurId).toBe('vendeur-1');
    expect(envoi().titre).toBe('Compte suspendu');
  });

  test('l’acheteur aussi', async () => {
    mockUtilisateurFindOne.mockResolvedValue(compte('acheteur-1', 'Acheteur'));

    await AdminService.suspendreAcheteur('acheteur-1');
    await vider();

    expect(envoi().utilisateurId).toBe('acheteur-1');
  });

  test('la réactivation se dit également', async () => {
    await AdminService.activerVendeur('vendeur-1');
    await vider();

    expect(envoi().titre).toContain('réactivé');
  });

  test('un compte introuvable ne notifie personne', async () => {
    mockUtilisateurFindOne.mockResolvedValue(null);

    await expect(AdminService.suspendreVendeur('fantome')).rejects.toThrow();
    expect(mockCreerNotification).not.toHaveBeenCalled();
  });
});

describe('Site de la boutique', () => {
  beforeEach(() => {
    mockBoutiqueFindByPk.mockResolvedValue({
      id: 'b-1',
      nom: 'Chez Awa',
      slug: 'chez-awa',
      vendeurId: 'vendeur-1',
      vitrineConfiguree: true,
      vitrineActive: false,
      update: jest.fn(async function (maj) { Object.assign(this, maj); }),
    });
  });

  test('une coupure est dite au vendeur', async () => {
    // Il partage l'adresse de son site sur WhatsApp et l'imprime sur ses
    // cartes : qu'elle cesse de répondre en silence se paie en clients.
    await AdminService.basculerSiteBoutique('b-1', false);
    await vider();

    expect(envoi().titre).toContain('hors ligne');
    expect(envoi().data.ecran).toBe('ma_boutique');
  });

  test('une publication aussi, avec l’adresse', async () => {
    await AdminService.basculerSiteBoutique('b-1', true);
    await vider();

    expect(envoi().titre).toContain('en ligne');
    expect(envoi().message).toContain('chez-awa');
  });
});

describe('Signalement', () => {
  test('celui qui a signalé apprend que c’est traité', async () => {
    await AdminService.traiterSignalement('sig-1');
    await vider();

    expect(envoi().utilisateurId).toBe('acheteur-1');
    expect(envoi().data.ecran).toBe('mes_signalements');
  });

  test('et qu’il a été examiné sans suite, le cas échéant', async () => {
    // Sans ce message, « en attente » restait affiché indéfiniment et celui
    // qui signale finissait par croire que personne ne lisait.
    await AdminService.rejeterSignalement('sig-1');
    await vider();

    expect(envoi().titre).toContain('examiné');
    expect(envoi().utilisateurId).toBe('acheteur-1');
  });
});
