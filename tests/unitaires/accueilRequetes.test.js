/**
 * Le nombre de requetes que coute l'accueil d'un acheteur.
 *
 * C'est le premier ecran de l'application, celui que tout le monde ouvre, et
 * le plus lourd : treize branches en parallele. Trois d'entre elles avaient
 * besoin des boutiques suivies, et chacune interrogeait `favori` de son cote
 * — trois allers-retours identiques, avec le meme `where`, a chaque
 * ouverture.
 *
 * Ce test ne mesure pas un temps, qui varierait d'une machine a l'autre : il
 * COMPTE LES REQUETES, ce qui ne ment pas.
 */

const mockFavoriFindAll = jest.fn();

jest.mock('../../src/models', () => {
  const vide = { findAll: jest.fn().mockResolvedValue([]), findOne: jest.fn().mockResolvedValue(null), findByPk: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0) };
  return {
    Favori: { findAll: (...a) => mockFavoriFindAll(...a) },
    Boutique: { ...vide },
    Produit: { ...vide },
    Categorie: { ...vide },
    PreferenceClient: {
      findOrCreate: jest.fn().mockResolvedValue([
        { affinites: {}, interets: [], recherchesRecentes: [], latitude: null, longitude: null, update: jest.fn() },
      ]),
    },
    Avis: { ...vide },
    Utilisateur: { ...vide },
    Promotion: { ...vide },
    LigneCommande: { ...vide },
    Commande: { ...vide },
  };
});
jest.mock('../../src/config/db', () => ({
  transaction: jest.fn(), define: jest.fn(() => ({})), fn: jest.fn(), col: jest.fn(), literal: jest.fn(),
}));
jest.mock('../../src/services/catalogue/catalogue.service', () => ({
  promotions: jest.fn().mockResolvedValue({ produits: [] }),
  lister: jest.fn().mockResolvedValue({ produits: [] }),
  _enrichir: jest.fn(async (p) => p),
}));
jest.mock('../../src/services/categories/categorie.service', () => ({
  getAllCategories: jest.fn().mockResolvedValue({ categories: [] }),
}));
jest.mock('../../src/services/categories/categorieBoutique.service', () => ({
  resoudre: jest.fn().mockResolvedValue([]),
}));

const AccueilService = require('../../src/services/acheteurs/accueil.service');

const CLIENT = { id: 'u1' };

beforeEach(() => {
  jest.clearAllMocks();
  mockFavoriFindAll.mockResolvedValue([
    { boutiqueId: 'b1' },
    { boutiqueId: 'b2' },
  ]);
});

describe('L’accueil ne lit les favoris qu’une fois', () => {
  test('une seule requete sur `favori`, pas trois', async () => {
    await AccueilService.construire({ utilisateur: CLIENT });

    expect(mockFavoriFindAll).toHaveBeenCalledTimes(1);
  });

  test('elle est ordonnee : « Vos boutiques » garde son ordre', async () => {
    // La plus recemment suivie en premier. Les deux autres sections n'ont pas
    // besoin de cet ordre, mais le partager coute moins qu'une requete de
    // plus.
    await AccueilService.construire({ utilisateur: CLIENT });

    const [options] = mockFavoriFindAll.mock.calls[0];
    expect(options.where).toEqual({ acheteurId: 'u1' });
    expect(options.order).toEqual([['createdAt', 'DESC']]);
    // Seule la colonne utile est lue.
    expect(options.attributes).toEqual(['boutiqueId']);
  });

  test('un invite ne declenche aucune lecture des favoris', async () => {
    await AccueilService.construire({ utilisateur: null, interetsInvite: [] });

    expect(mockFavoriFindAll).not.toHaveBeenCalled();
  });
});

describe('Les sections restent servies quand on les demande seules', () => {
  test('« Voir tout » des boutiques suivies lit les favoris lui-meme', async () => {
    // Appelee hors de `construire`, la section n'a personne pour lui passer
    // les favoris : elle doit savoir se debrouiller.
    await AccueilService.section('suivies', { utilisateur: CLIENT });

    expect(mockFavoriFindAll).toHaveBeenCalledTimes(1);
  });
});
