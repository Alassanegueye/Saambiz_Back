/**
 * Une commande nomme la boutique, pas seulement la personne qui la tient.
 *
 * Le client a commandé chez « FootShop » ; ses commandes ne lui montraient
 * que « Alassane GUEYE », le compte du vendeur. La liste et le détail
 * chargent donc le vendeur avec sa boutique (nom, logo).
 */

const mockFindAll = jest.fn().mockResolvedValue([]);
const mockFindByPk = jest.fn().mockResolvedValue(null);

jest.mock('../../src/services/socket.service', () => ({ getIO: jest.fn() }));
jest.mock('../../src/models', () => ({
  Commande: {
    findAll: (...a) => mockFindAll(...a),
    findByPk: (...a) => mockFindByPk(...a),
  },
  LigneCommande: { name: 'LigneCommande' },
  Produit: {},
  Utilisateur: { name: 'Utilisateur' },
  Boutique: { name: 'Boutique' },
}));
jest.mock('../../src/config/db', () => ({
  transaction: jest.fn(),
  define: jest.fn(() => ({})),
}));
// Rien de ce qui suit n'est sollicité par une lecture de commandes, mais le
// module doit pouvoir se charger sans base ni clé Firebase.
jest.mock('../../src/services/notifications/notification.service', () => ({
  creerNotification: jest.fn(),
  notifierUtilisateurs: jest.fn(),
  notifierAbonnesBoutique: jest.fn(),
}));
jest.mock('../../src/services/resend.service', () => ({
  sendNouvelleCommandeEmail: jest.fn(),
  sendCommandeClientEmail: jest.fn(),
}));

const { Boutique } = require('../../src/models');
const CommandeService = require('../../src/services/commandes/commande.service');

const vendeurDe = (options) => options.include.find((i) => i.as === 'vendeur');

const boutiqueAttendue = expect.objectContaining({
  model: Boutique,
  as: 'boutiques',
  attributes: expect.arrayContaining(['id', 'nom', 'logo']),
  required: false,
});

describe('Les commandes du client nomment la boutique', () => {
  beforeEach(() => {
    mockFindAll.mockClear();
    mockFindByPk.mockClear();
  });

  it('dans la liste « Mes commandes »', async () => {
    await CommandeService.mesCommandes('acheteur-1');
    const vendeur = vendeurDe(mockFindAll.mock.calls[0][0]);
    expect(vendeur.include).toEqual([boutiqueAttendue]);
  });

  it('dans le détail d’une commande', async () => {
    await CommandeService.getCommandeComplete('commande-1');
    const vendeur = vendeurDe(mockFindByPk.mock.calls[0][1]);
    expect(vendeur.include).toEqual([boutiqueAttendue]);
  });

  it('le vendeur garde ses champs, sans plus', async () => {
    await CommandeService.mesCommandes('acheteur-1');
    const vendeur = vendeurDe(mockFindAll.mock.calls[0][0]);
    expect(vendeur.attributes).toEqual(['id', 'nom', 'prenom', 'telephone']);
  });

  it('chaque requête reçoit son propre include', async () => {
    // Sequelize annote les options qu'on lui passe : un objet partagé entre
    // deux requêtes garderait les traces de la première.
    await CommandeService.mesCommandes('acheteur-1');
    await CommandeService.mesCommandes('acheteur-1');
    const [premier, second] = mockFindAll.mock.calls.map((c) => vendeurDe(c[0]));
    expect(premier).not.toBe(second);
  });
});
