/**
 * Un produit qui tombe à zéro passe hors ligne — et le vendeur l'apprend.
 *
 * C'est le silence qui coûtait : la fiche disparaissait des recherches, le
 * vendeur continuait de croire qu'il vendait, et il attendait des commandes
 * que plus personne ne pouvait passer.
 *
 * Après le commit seulement : un stock décrémenté puis annulé — paiement
 * refusé, transaction rejouée — ne doit pas laisser une fausse alerte
 * derrière lui.
 */

const mockCreerNotification = jest.fn(async () => ({}));
const mockLigneFindAll = jest.fn();
const mockProduitFindAll = jest.fn();

jest.mock('../../src/services/socket.service', () => ({
  getIO: () => ({ to: () => ({ emit: jest.fn() }) }),
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
jest.mock('../../src/models', () => ({
  Commande: { findByPk: jest.fn() },
  LigneCommande: { findAll: (...a) => mockLigneFindAll(...a) },
  Produit: { findAll: (...a) => mockProduitFindAll(...a) },
  Utilisateur: { findByPk: jest.fn(async () => null) },
  Boutique: { findOne: jest.fn(async () => null) },
  HistoriqueCommande: { create: jest.fn(async () => ({})) },
}));
jest.mock('../../src/config/db', () => ({
  transaction: jest.fn(), define: jest.fn(() => ({})),
}));

const CommandeService = require('../../src/services/commandes/commande.service');

const vider = () => new Promise((r) => setImmediate(r));

/** Une transaction qui ne joue ses `afterCommit` qu'au commit. */
function transactionFactice() {
  const hooks = [];
  return {
    LOCK: { UPDATE: 'UPDATE' },
    afterCommit: (fn) => hooks.push(fn),
    commit: async () => { for (const fn of hooks) await fn(); },
    hooks,
  };
}

const commande = () => ({
  id: 'cmd-1',
  vendeurId: 'vendeur-1',
  stockDecremente: false,
  save: jest.fn(async () => {}),
});

function produit(nom, quantite) {
  return { id: `p-${nom}`, nom, quantite, disponible: true, save: jest.fn(async () => {}) };
}

beforeEach(() => jest.clearAllMocks());

describe('Le dernier exemplaire part', () => {
  test('le vendeur est prévenu, et le produit nommé', async () => {
    const robe = produit('Robe wax', 2);
    mockLigneFindAll.mockResolvedValue([{ produitId: 'p-Robe wax', quantite: 2 }]);
    mockProduitFindAll.mockResolvedValue([robe]);
    const t = transactionFactice();

    await CommandeService._decrementerStock(commande(), t);
    await t.commit();
    await vider();

    expect(robe.quantite).toBe(0);
    expect(robe.disponible).toBe(false);
    expect(mockCreerNotification).toHaveBeenCalledTimes(1);
    const envoi = mockCreerNotification.mock.calls[0][0];
    expect(envoi.utilisateurId).toBe('vendeur-1');
    expect(envoi.message).toContain('Robe wax');
    expect(envoi.data.ecran).toBe('mes_produits');
  });

  test('rien ne part tant que la vente n’est pas validée', async () => {
    // Paiement refusé, transaction rejouée : pas de fausse alerte.
    mockLigneFindAll.mockResolvedValue([{ produitId: 'p-Robe wax', quantite: 2 }]);
    mockProduitFindAll.mockResolvedValue([produit('Robe wax', 2)]);
    const t = transactionFactice();

    await CommandeService._decrementerStock(commande(), t);
    await vider();

    expect(t.hooks).toHaveLength(1);
    expect(mockCreerNotification).not.toHaveBeenCalled();
  });

  test('plusieurs produits épuisés tiennent dans un seul message', async () => {
    // Trois notifications pour une commande, ce serait trois bannières d'un
    // coup pour un seul événement.
    mockLigneFindAll.mockResolvedValue([
      { produitId: 'p-Robe wax', quantite: 1 },
      { produitId: 'p-Foulard', quantite: 1 },
    ]);
    mockProduitFindAll.mockResolvedValue([produit('Robe wax', 1), produit('Foulard', 1)]);
    const t = transactionFactice();

    await CommandeService._decrementerStock(commande(), t);
    await t.commit();
    await vider();

    expect(mockCreerNotification).toHaveBeenCalledTimes(1);
    const { titre, message } = mockCreerNotification.mock.calls[0][0];
    expect(titre).toContain('Produits');
    expect(message).toContain('Robe wax');
    expect(message).toContain('Foulard');
  });
});

describe('Ce qui ne déclenche rien', () => {
  test('du stock restant ne prévient pas', async () => {
    const robe = produit('Robe wax', 10);
    mockLigneFindAll.mockResolvedValue([{ produitId: 'p-Robe wax', quantite: 2 }]);
    mockProduitFindAll.mockResolvedValue([robe]);
    const t = transactionFactice();

    await CommandeService._decrementerStock(commande(), t);
    await t.commit();
    await vider();

    expect(robe.quantite).toBe(8);
    expect(robe.disponible).toBe(true);
    expect(mockCreerNotification).not.toHaveBeenCalled();
  });

  test('une commande saisie par le vendeur ne met rien hors ligne', async () => {
    // `forcer` : c'est le vendeur qui tient l'interrupteur « En ligne », pas
    // une vente qu'il a enregistrée lui-même au comptoir.
    const robe = produit('Robe wax', 2);
    mockLigneFindAll.mockResolvedValue([{ produitId: 'p-Robe wax', quantite: 2 }]);
    mockProduitFindAll.mockResolvedValue([robe]);
    const t = transactionFactice();

    await CommandeService._decrementerStock(commande(), t, { forcer: true });
    await t.commit();
    await vider();

    expect(robe.disponible).toBe(true);
    expect(mockCreerNotification).not.toHaveBeenCalled();
  });

  test('un stock déjà décrémenté ne repasse pas', async () => {
    const dejaFait = { ...commande(), stockDecremente: true };

    await CommandeService._decrementerStock(dejaFait, transactionFactice());
    await vider();

    expect(mockCreerNotification).not.toHaveBeenCalled();
  });
});
