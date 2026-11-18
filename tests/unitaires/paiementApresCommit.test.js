/**
 * On ne prévient personne d'un encaissement tant qu'il n'est pas enregistré.
 *
 * `marquerCommandePayee` est appelée par le webhook de la passerelle, qui lui
 * passe SA transaction et la valide lui-même après coup. Les notifications
 * partaient à la fin de la méthode, donc À L'INTÉRIEUR d'une transaction
 * encore ouverte : si le commit échouait ensuite, le client et le vendeur
 * avaient déjà reçu « Paiement reçu » pour un paiement que la base n'a jamais
 * gardé. L'e-mail, lui, relisait la commande hors transaction et y trouvait
 * encore l'ancien statut.
 *
 * Tout ce qui s'adresse au dehors — historique, diffusion temps réel,
 * notifications — passe maintenant par `afterCommit`, qui ne se déclenche
 * jamais sur un rollback.
 */

const mockCreerNotification = jest.fn();
const mockHistorique = jest.fn();

jest.mock('../../src/services/socket.service', () => ({
  getIO: () => ({ to: () => ({ emit: jest.fn() }) }),
}));
jest.mock('../../src/models', () => ({
  Commande: { findByPk: jest.fn() },
  LigneCommande: {},
  Produit: {},
  Utilisateur: { findByPk: jest.fn(async () => null) },
  Boutique: { findOne: jest.fn(async () => null) },
  HistoriqueCommande: { create: (...a) => { mockHistorique(...a); return Promise.resolve({}); } },
}));
jest.mock('../../src/config/db', () => ({
  transaction: jest.fn(),
  define: jest.fn(() => ({})),
}));
jest.mock('../../src/services/notifications/notification.service', () => ({
  creerNotification: (...a) => mockCreerNotification(...a),
  notifierUtilisateurs: jest.fn(),
  notifierAbonnesBoutique: jest.fn(),
}));
jest.mock('../../src/services/resend.service', () => ({
  sendCommandeClientEmail: jest.fn(),
  sendNouvelleCommandeEmail: jest.fn(),
}));

const sequelize = require('../../src/config/db');
const { Commande } = require('../../src/models');
const CommandeService = require('../../src/services/commandes/commande.service');

const vider = () => new Promise((r) => setImmediate(r));

/** Une transaction qui retient ses `afterCommit` et ne les joue qu'au commit. */
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

function commandeFactice() {
  return {
    id: 'cmd-1',
    referenceCommande: 'CMD-2026-LREV6T',
    montantTotal: '5500.00',
    statut: 'en_attente',
    statutPaiement: 'non_paye',
    acheteurId: 'acheteur-1',
    vendeurId: 'vendeur-1',
    // Déjà décrémenté : le stock n'est pas le sujet de ce fichier.
    stockDecremente: true,
    save: jest.fn(async () => {}),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  Commande.findByPk.mockImplementation(async () => commandeFactice());
});

describe('Transaction de l’appelant (le webhook de paiement)', () => {
  test('rien ne part tant que l’appelant n’a pas validé', async () => {
    const t = transactionFactice();

    await CommandeService.marquerCommandePayee('cmd-1', t);
    await vider();

    expect(t.hooks).toHaveLength(1);
    expect(mockCreerNotification).not.toHaveBeenCalled();
    expect(mockHistorique).not.toHaveBeenCalled();
  });

  test('tout part une fois le commit passé', async () => {
    const t = transactionFactice();

    await CommandeService.marquerCommandePayee('cmd-1', t);
    await t.commit();
    await vider();

    // Le vendeur (« Commande payée ») et l'acheteur (« Paiement reçu »).
    expect(mockCreerNotification).toHaveBeenCalledTimes(2);
    expect(mockHistorique).toHaveBeenCalledTimes(1);
  });

  test('un rollback ne prévient personne', async () => {
    // Le cas qui comptait : le paiement échoue à s'enregistrer, et personne
    // ne doit avoir appris qu'il était encaissé.
    const t = transactionFactice();

    await CommandeService.marquerCommandePayee('cmd-1', t);
    await t.rollback();
    await vider();

    expect(mockCreerNotification).not.toHaveBeenCalled();
    expect(mockHistorique).not.toHaveBeenCalled();
  });
});

describe('Transaction ouverte par le service lui-même', () => {
  test('les notifications partent, après le commit', async () => {
    const t = transactionFactice();
    sequelize.transaction.mockResolvedValue(t);

    await CommandeService.marquerCommandePayee('cmd-1');
    await vider();

    expect(t.commit).toHaveBeenCalledTimes(1);
    expect(mockCreerNotification).toHaveBeenCalledTimes(2);
  });

  test('une commande déjà payée ne renotifie pas', async () => {
    // Une passerelle rejoue volontiers son webhook. Deux appels ne doivent
    // pas donner deux fois « Paiement reçu » au même client.
    const t = transactionFactice();
    sequelize.transaction.mockResolvedValue(t);
    Commande.findByPk.mockImplementation(async () => ({
      ...commandeFactice(),
      statutPaiement: 'paye',
    }));

    await CommandeService.marquerCommandePayee('cmd-1');
    await vider();

    expect(mockCreerNotification).not.toHaveBeenCalled();
  });
});
