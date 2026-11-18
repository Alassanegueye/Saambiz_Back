/**
 * L'abonnement garde son e-mail, ET reçoit une notification.
 *
 * C'est l'inverse de la règle des commandes, et c'est voulu : une commande
 * change de statut six fois en une journée, un abonnement se paie une fois
 * par mois. L'e-mail de confirmation est une facture — un montant, des dates,
 * quelque chose qu'on retrouve ailleurs que dans l'application. Et le rappel
 * d'expiration est le seul message qu'on ne veut pas voir manqué parce qu'un
 * téléphone était éteint ce jour-là : un abonnement expiré, c'est la boutique
 * qui ferme.
 *
 * Deux choses sont vérifiées ici, en plus de la présence des deux canaux :
 *
 *  - la notification passe par `creerNotification`, et non par un push
 *    direct. Le push seul affichait une bannière qui ne laissait AUCUNE
 *    trace : rien dans le centre de notifications, compteur de non-lus
 *    immobile ;
 *  - elle porte `type: 'abonnement'` et l'identifiant de l'abonnement. C'est
 *    ce que le téléphone lit pour ouvrir « Mon abonnement ». L'ancien
 *    `type: 'rappel_abonnement'`, inconnu de l'application, faisait retomber
 *    le toucher sur la messagerie.
 */

const mockEmailExpiration = jest.fn();
const mockEmailConfirme = jest.fn();
const mockCreerNotification = jest.fn(async () => ({}));
const mockAbonnementFindAll = jest.fn();

jest.mock('../../src/models', () => ({
  Abonnement: {
    update: jest.fn(async () => [0]),
    findAll: (...a) => mockAbonnementFindAll(...a),
    create: jest.fn(),
  },
  Utilisateur: { findByPk: jest.fn() },
  Paiement: {},
}));
jest.mock('../../src/config/db', () => ({
  transaction: jest.fn(),
  define: jest.fn(() => ({})),
}));
jest.mock('../../src/services/resend.service', () => ({
  sendAbonnementExpiration: (...a) => mockEmailExpiration(...a),
  sendAbonnementConfirme: (...a) => mockEmailConfirme(...a),
}));
jest.mock('../../src/services/notifications/notification.service', () => ({
  creerNotification: (...a) => mockCreerNotification(...a),
}));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const expireAbonnements = require('../../src/jobs/abonnement.job');

const vider = () => new Promise((r) => setImmediate(r));

const VENDEUR = {
  id: 'vendeur-1',
  nom: 'Ndiaye',
  prenom: 'Alioune',
  email: 'alioune@exemple.sn',
  role: 'Vendeur',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockEmailExpiration.mockResolvedValue({});
  // Le job lit d'abord les abonnements ÉCHUS (aucun ici), puis ceux qui
  // approchent de l'échéance — une fois pour sept jours, une fois pour trois.
  mockAbonnementFindAll
    .mockResolvedValueOnce([])
    .mockResolvedValue([
      { id: 'abo-1', dateFin: new Date('2026-12-01'), utilisateur: VENDEUR },
    ]);
});

describe('Les rappels d’expiration', () => {
  test('partent par e-mail ET par notification', async () => {
    await expireAbonnements();
    await vider();

    // Deux échéances, 7 jours et 3 jours : deux de chaque.
    expect(mockEmailExpiration).toHaveBeenCalledTimes(2);
    expect(mockCreerNotification).toHaveBeenCalledTimes(2);
  });

  test('la notification mène à « Mon abonnement »', async () => {
    await expireAbonnements();
    await vider();

    const envoi = mockCreerNotification.mock.calls[0][0];
    expect(envoi.utilisateurId).toBe('vendeur-1');
    expect(envoi.type).toBe('abonnement');
    expect(envoi.data.abonnementId).toBe('abo-1');
  });

  test('elle dit combien de jours il reste', async () => {
    await expireAbonnements();
    await vider();

    const titres = mockCreerNotification.mock.calls.map(([e]) => e.titre);
    expect(titres[0]).toContain('7 jours');
    expect(titres[1]).toContain('3 jours');
  });

  test('un acheteur n’est jamais rappelé', async () => {
    // Un acheteur n'a pas d'abonnement ; une requête mal filtrée en a déjà
    // désactivé tous les comptes une nuit, le filtre de rôle reste surveillé.
    mockAbonnementFindAll
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        { id: 'abo-2', dateFin: new Date(), utilisateur: { ...VENDEUR, role: 'Acheteur' } },
      ]);

    await expireAbonnements();
    await vider();

    expect(mockEmailExpiration).not.toHaveBeenCalled();
    expect(mockCreerNotification).not.toHaveBeenCalled();
  });

  test('un e-mail refusé n’empêche pas la notification', async () => {
    // Les deux canaux sont indépendants : c'est tout l'intérêt d'en avoir deux.
    mockEmailExpiration.mockRejectedValue(new Error('Resend indisponible'));

    await expireAbonnements();
    await vider();

    expect(mockCreerNotification).toHaveBeenCalledTimes(2);
  });
});
