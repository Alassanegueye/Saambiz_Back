/**
 * L'abonnement activé : e-mail ET notification, après le commit.
 *
 * Les deux partaient d'un endroit où la transaction était encore ouverte. Si
 * son commit échouait ensuite, le vendeur avait déjà lu « Abonnement activé »
 * pour un abonnement que la base n'a jamais enregistré — et il aurait fallu
 * le rembourser d'un service qu'il croyait avoir. `afterCommit` ne se
 * déclenche jamais sur un rollback.
 *
 * La notification, elle, passait par un push direct : une bannière, et rien
 * dans le centre de notifications. Elle passe maintenant par le même chemin
 * que les autres, qui écrit la ligne, bouge le compteur de non-lus et envoie
 * le push.
 */

const mockEmailConfirme = jest.fn(async () => ({}));
const mockCreerNotification = jest.fn(async () => ({}));
const mockPaiementFindOne = jest.fn();
const mockCommandeFindByPk = jest.fn();
const mockAbonnementCreate = jest.fn();
const mockUtilisateurFindByPk = jest.fn();

jest.mock('../../src/models', () => ({
  Paiement: { findOne: (...a) => mockPaiementFindOne(...a) },
  Commande: { findByPk: (...a) => mockCommandeFindByPk(...a) },
  Abonnement: { create: (...a) => mockAbonnementCreate(...a) },
  Utilisateur: { findByPk: (...a) => mockUtilisateurFindByPk(...a) },
}));
jest.mock('../../src/config/db', () => ({ transaction: jest.fn(), define: jest.fn(() => ({})) }));
jest.mock('../../src/services/resend.service', () => ({
  sendAbonnementConfirme: (...a) => mockEmailConfirme(...a),
}));
jest.mock('../../src/services/notifications/notification.service', () => ({
  creerNotification: (...a) => mockCreerNotification(...a),
}));
jest.mock('../../src/services/paiement/wave.service', () => ({}));
jest.mock('../../src/services/paiement/orangeMoney.service', () => ({}));
jest.mock('../../src/services/config/config.service', () => ({
  getPrixAbonnement: jest.fn(async () => 5000),
}));

const sequelize = require('../../src/config/db');
const PaiementService = require('../../src/services/paiement/paiement.service');

const vider = () => new Promise((r) => setImmediate(r));

/** Une transaction qui ne joue ses `afterCommit` qu'au commit. */
function transactionFactice() {
  const hooks = [];
  return {
    LOCK: { UPDATE: 'UPDATE' },
    afterCommit: (fn) => hooks.push(fn),
    commit: jest.fn(async () => {
      for (const fn of hooks) await fn();
    }),
    rollback: jest.fn(async () => {}),
    hooks,
  };
}

let t;

beforeEach(() => {
  jest.clearAllMocks();
  t = transactionFactice();
  sequelize.transaction.mockResolvedValue(t);

  mockPaiementFindOne.mockResolvedValue({
    id: 'pay-1',
    type: 'abonnement',
    montant: '5000',
    utilisateurId: 'vendeur-1',
    statut: 'en_attente',
    save: jest.fn(async () => {}),
  });
  mockAbonnementCreate.mockResolvedValue({ id: 'abo-1' });
  mockUtilisateurFindByPk.mockResolvedValue({
    id: 'vendeur-1',
    nom: 'Ndiaye',
    prenom: 'Alioune',
    email: 'alioune@exemple.sn',
  });
});

describe('Un abonnement payé', () => {
  test('envoie l’e-mail ET la notification', async () => {
    await PaiementService.confirmerPaiement({ transactionId: 'tx-1', status: 'SUCCESS' });
    await vider();

    expect(mockEmailConfirme).toHaveBeenCalledTimes(1);
    expect(mockEmailConfirme.mock.calls[0][0].to).toBe('alioune@exemple.sn');
    expect(mockCreerNotification).toHaveBeenCalledTimes(1);
  });

  test('la notification mène à « Mon abonnement »', async () => {
    await PaiementService.confirmerPaiement({ transactionId: 'tx-1', status: 'SUCCESS' });
    await vider();

    const envoi = mockCreerNotification.mock.calls[0][0];
    expect(envoi.utilisateurId).toBe('vendeur-1');
    expect(envoi.type).toBe('abonnement');
    expect(envoi.data.abonnementId).toBe('abo-1');
  });

  test('rien ne part avant le commit', async () => {
    // Le hook est posé, mais la transaction n'est pas encore validée.
    const paiement = {
      id: 'pay-1',
      type: 'abonnement',
      montant: '5000',
      utilisateurId: 'vendeur-1',
      statut: 'en_attente',
      save: jest.fn(async () => {}),
    };
    mockPaiementFindOne.mockResolvedValue(paiement);
    // On empêche le commit automatique pour observer l'entre-deux.
    t.commit.mockImplementation(async () => {});

    await PaiementService.confirmerPaiement({ transactionId: 'tx-1', status: 'SUCCESS' });
    await vider();

    expect(t.hooks).toHaveLength(1);
    expect(mockEmailConfirme).not.toHaveBeenCalled();
    expect(mockCreerNotification).not.toHaveBeenCalled();
  });
});

describe('Un paiement qui échoue', () => {
  test('n’envoie aucun e-mail de confirmation', async () => {
    await PaiementService.confirmerPaiement({ transactionId: 'tx-1', status: 'FAILED' });
    await vider();

    expect(mockEmailConfirme).not.toHaveBeenCalled();
  });

  test('mais le dit au vendeur : son abonnement n’est pas actif', async () => {
    // Le silence était pire que le refus : le vendeur croyait avoir payé.
    await PaiementService.confirmerPaiement({ transactionId: 'tx-1', status: 'FAILED' });
    await vider();

    expect(mockCreerNotification).toHaveBeenCalledTimes(1);
    const envoi = mockCreerNotification.mock.calls[0][0];
    expect(envoi.utilisateurId).toBe('vendeur-1');
    expect(envoi.titre).toContain('refusé');
    expect(envoi.type).toBe('abonnement');
  });

  test('un montant insuffisant est un refus, et se dit aussi', async () => {
    await PaiementService.confirmerPaiement({
      transactionId: 'tx-1',
      status: 'SUCCESS',
      montantRecu: 1000,
    });
    await vider();

    expect(mockEmailConfirme).not.toHaveBeenCalled();
    expect(mockCreerNotification).toHaveBeenCalledTimes(1);
    expect(mockCreerNotification.mock.calls[0][0].titre).toContain('refusé');
  });

  test('le refus d’une commande va à l’acheteur, et ouvre sa commande', async () => {
    // C'est de sa commande qu'il peut repayer : l'y mener directement est
    // tout l'intérêt de la notification.
    mockPaiementFindOne.mockResolvedValue({
      id: 'pay-2',
      type: 'commande',
      commandeId: 'cmd-1',
      montant: '5000',
      utilisateurId: 'acheteur-1',
      statut: 'en_attente',
      save: jest.fn(async () => {}),
    });
    mockCommandeFindByPk.mockResolvedValue({
      id: 'cmd-1',
      acheteurId: 'acheteur-1',
      referenceCommande: 'CMD-2026-LREV6T',
    });

    await PaiementService.confirmerPaiement({ transactionId: 'tx-2', status: 'FAILED' });
    await vider();

    const envoi = mockCreerNotification.mock.calls[0][0];
    expect(envoi.utilisateurId).toBe('acheteur-1');
    expect(envoi.message).toContain('CMD-2026-LREV6T');
    expect(envoi.data.commandeId).toBe('cmd-1');
  });

  test('une commande passée sans compte ne notifie personne', async () => {
    // Pas d'application, donc pas d'appareil : le site de la boutique
    // affiche le refus.
    mockPaiementFindOne.mockResolvedValue({
      id: 'pay-3',
      type: 'commande',
      commandeId: 'cmd-2',
      montant: '5000',
      utilisateurId: null,
      statut: 'en_attente',
      save: jest.fn(async () => {}),
    });
    mockCommandeFindByPk.mockResolvedValue({
      id: 'cmd-2', acheteurId: null, referenceCommande: 'CMD-2026-XXXX',
    });

    await PaiementService.confirmerPaiement({ transactionId: 'tx-3', status: 'FAILED' });
    await vider();

    expect(mockCreerNotification).not.toHaveBeenCalled();
  });

  test('rien ne part avant le commit, là non plus', async () => {
    t.commit.mockImplementation(async () => {});

    await PaiementService.confirmerPaiement({ transactionId: 'tx-1', status: 'FAILED' });
    await vider();

    expect(t.hooks).toHaveLength(1);
    expect(mockCreerNotification).not.toHaveBeenCalled();
  });
});
