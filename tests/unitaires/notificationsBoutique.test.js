/**
 * La vie de la boutique arrive au vendeur : un avis, un abonné.
 *
 * Deux signaux qu'il ne recevait pas. Un avis est la seule chose que ses
 * clients lui disent publiquement — et une mauvaise note découverte à temps
 * peut encore se rattraper. Un nouvel abonné est le signal le moins coûteux à
 * envoyer et le plus encourageant à recevoir.
 *
 * Dans les deux cas, le vendeur qui agit sur sa propre boutique ne se
 * notifie pas lui-même.
 */

const mockCreerNotification = jest.fn(async () => ({}));
const mockBoutiqueFindByPk = jest.fn();
const mockUtilisateurFindByPk = jest.fn();
const mockAvisFindOrCreate = jest.fn();
const mockAvisFindOne = jest.fn();
const mockFavoriFindOrCreate = jest.fn();

jest.mock('../../src/services/notifications/notification.service', () => ({
  creerNotification: (...a) => mockCreerNotification(...a),
}));
jest.mock('../../src/models', () => ({
  Avis: {
    findOrCreate: (...a) => mockAvisFindOrCreate(...a),
    findOne: (...a) => mockAvisFindOne(...a),
    findAll: jest.fn(async () => []),
  },
  Favori: { findOrCreate: (...a) => mockFavoriFindOrCreate(...a), destroy: jest.fn() },
  Boutique: { findByPk: (...a) => mockBoutiqueFindByPk(...a) },
  Utilisateur: { findByPk: (...a) => mockUtilisateurFindByPk(...a) },
}));
jest.mock('../../src/config/db', () => ({
  transaction: jest.fn(), define: jest.fn(() => ({})),
  fn: jest.fn(), col: jest.fn(), literal: jest.fn(),
}));

const AvisService = require('../../src/services/avis/avis.service');
const FavoriService = require('../../src/services/favoris/favori.service');

const vider = () => new Promise((r) => setImmediate(r));
const envoi = () => mockCreerNotification.mock.calls[0][0];

const BOUTIQUE = { id: 'b-1', nom: 'Chez Awa', vendeurId: 'vendeur-1' };

beforeEach(() => {
  jest.clearAllMocks();
  mockBoutiqueFindByPk.mockResolvedValue(BOUTIQUE);
  mockUtilisateurFindByPk.mockResolvedValue({ prenom: 'Moussa', nom: 'Ndiaye' });
  mockAvisFindOrCreate.mockResolvedValue([{ id: 'avis-1', update: jest.fn() }, true]);
  mockAvisFindOne.mockResolvedValue(null);
  mockFavoriFindOrCreate.mockResolvedValue([{ id: 'fav-1' }, true]);
  // statsBoutique interroge Avis ; elle n'est pas le sujet ici.
  jest.spyOn(AvisService, 'statsBoutique').mockResolvedValue({ moyenne: 4, total: 1 });
});

describe('Un avis reçu', () => {
  test('le vendeur apprend sa note et lit le début du commentaire', async () => {
    await AvisService.laisserAvis('acheteur-1', 'b-1', 4, 'Livraison rapide, merci !');
    await vider();

    expect(envoi().utilisateurId).toBe('vendeur-1');
    expect(envoi().titre).toContain('4/5');
    expect(envoi().message).toContain('Moussa Ndiaye');
    expect(envoi().message).toContain('Livraison rapide');
    expect(envoi().data.ecran).toBe('ma_boutique');
  });

  test('un avis sans commentaire se dit quand même', async () => {
    await AvisService.laisserAvis('acheteur-1', 'b-1', 2, null);
    await vider();

    expect(envoi().titre).toContain('2/5');
  });

  test('le vendeur qui note sa propre boutique ne se notifie pas', async () => {
    await AvisService.laisserAvis('vendeur-1', 'b-1', 5, 'Parfait');
    await vider();

    expect(mockCreerNotification).not.toHaveBeenCalled();
  });

  test('une note invalide ne notifie personne', async () => {
    const r = await AvisService.laisserAvis('acheteur-1', 'b-1', 9, 'Excellent');
    await vider();

    expect(r.success).toBe(false);
    expect(mockCreerNotification).not.toHaveBeenCalled();
  });
});

describe('Un nouvel abonné', () => {
  test('le vendeur est prévenu, avec le nom de son abonné', async () => {
    await FavoriService.ajouterFavori('acheteur-1', 'b-1');
    await vider();

    expect(envoi().utilisateurId).toBe('vendeur-1');
    expect(envoi().message).toContain('Moussa Ndiaye');
    expect(envoi().message).toContain('Chez Awa');
    expect(envoi().data.ecran).toBe('abonnes');
  });

  test('suivre une seconde fois ne renotifie pas', async () => {
    // `findOrCreate` ne crée rien : la boutique était déjà suivie.
    mockFavoriFindOrCreate.mockResolvedValue([{ id: 'fav-1' }, false]);

    await FavoriService.ajouterFavori('acheteur-1', 'b-1');
    await vider();

    expect(mockCreerNotification).not.toHaveBeenCalled();
  });

  test('le vendeur qui suit sa propre boutique ne se notifie pas', async () => {
    await FavoriService.ajouterFavori('vendeur-1', 'b-1');
    await vider();

    expect(mockCreerNotification).not.toHaveBeenCalled();
  });
});
