/**
 * Le statut d'une commande doit arriver aux DEUX parties, tout de suite.
 *
 * Avant, rien ne traversait : le serveur notifiait l'acheteur d'un message à
 * lire, et c'était tout. Les écrans de commandes, eux, ne se relisaient qu'au
 * retour d'onglet ou au retour de la fiche. Le tableau de bord du vendeur
 * pouvait donc afficher « En attente » pendant que l'acheteur lisait
 * « Acceptée » sur la même commande, chacun figé sur ce qu'il avait lu en
 * arrivant.
 *
 * La charge reste volontairement minuscule : l'identifiant et les deux
 * statuts. Le détail d'une commande — lignes, client, montants — n'a rien à
 * faire sur un canal diffusé.
 */

const mockEmit = jest.fn();
const mockTo = jest.fn(() => ({ emit: mockEmit }));
const mockGetIO = jest.fn(() => ({ to: mockTo }));

jest.mock('../../src/services/socket.service', () => ({
  getIO: (...a) => mockGetIO(...a),
}));

// Le service tire tout le reste du domaine ; rien de cela n'est sollicité par
// la diffusion, mais le module doit pouvoir se charger.
jest.mock('../../src/models', () => ({
  Commande: {},
  LigneCommande: {},
  Produit: {},
  Utilisateur: {},
  Boutique: {},
}));
jest.mock('../../src/config/db', () => ({
  transaction: jest.fn(),
  define: jest.fn(() => ({})),
}));
// Coupe la branche notifications → push → Firebase : rien de tout cela n'est
// sollicité par la diffusion, et son chargement exige une base et une clé.
jest.mock('../../src/services/notifications/notification.service', () => ({
  creerNotification: jest.fn(),
  notifierUtilisateurs: jest.fn(),
  notifierAbonnesBoutique: jest.fn(),
}));
jest.mock('../../src/services/resend.service', () => ({
  sendNouvelleCommandeEmail: jest.fn(),
  sendCommandeClientEmail: jest.fn(),
}));

const CommandeService = require('../../src/services/commandes/commande.service');

const COMMANDE = {
  id: 'cmd-1',
  statut: 'en_preparation',
  statutPaiement: 'non_paye',
  acheteurId: 'acheteur-1',
  vendeurId: 'vendeur-1',
};

beforeEach(() => jest.clearAllMocks());

describe('Diffusion du statut', () => {
  test('l’acheteur et le vendeur sont servis tous les deux', () => {
    CommandeService._diffuserStatut(COMMANDE);

    expect(mockTo).toHaveBeenCalledTimes(2);
    expect(mockTo.mock.calls.map(([salon]) => salon)).toEqual([
      'user:acheteur-1',
      'user:vendeur-1',
    ]);
    expect(mockEmit).toHaveBeenCalledTimes(2);
  });

  test('la charge ne porte que l’identifiant et les statuts', () => {
    CommandeService._diffuserStatut({ ...COMMANDE, total: 9000, lignes: [{}] });

    const [evenement, charge] = mockEmit.mock.calls[0];
    expect(evenement).toBe('commande:statut');
    expect(charge).toEqual({
      id: 'cmd-1',
      statut: 'en_preparation',
      statutPaiement: 'non_paye',
    });
  });

  test('une commande sans compte acheteur ne sert que le vendeur', () => {
    // Commande passée depuis le site d'une boutique : pas d'acheteurId.
    CommandeService._diffuserStatut({ ...COMMANDE, acheteurId: null });

    expect(mockTo).toHaveBeenCalledTimes(1);
    expect(mockTo).toHaveBeenCalledWith('user:vendeur-1');
  });

  test('Socket.IO absent ne fait pas echouer l’appel', () => {
    // La diffusion est un bonus : elle suit une transaction deja validee et
    // ne doit jamais la faire echouer. Au pire, l'ecran se relira au retour.
    mockGetIO.mockImplementationOnce(() => {
      throw new Error('Socket.IO non initialisé');
    });

    expect(() => CommandeService._diffuserStatut(COMMANDE)).not.toThrow();
    expect(mockEmit).not.toHaveBeenCalled();
  });
});
