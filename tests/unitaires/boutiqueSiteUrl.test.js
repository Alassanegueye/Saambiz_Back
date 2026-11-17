/**
 * L'adresse du site d'une boutique, telle que l'acheteur la recoit.
 *
 * Le `slug` existe des la creation de la boutique, bien avant que le vendeur
 * ne mette son site en ligne. Fabriquer le lien a partir du slug seul — dans
 * l'application, par exemple — enverrait donc l'acheteur sur une adresse
 * morte. C'est `vitrineActive` qui tranche, et il ne sortait pas du serveur.
 *
 * L'adresse est construite ici et pas cote mobile : la base publique vit
 * dans la configuration du serveur (VITRINE_BASE_URL), et le vendeur recoit
 * deja la sienne de la meme facon.
 */

const mockFindOne = jest.fn();

jest.mock('../../src/models', () => ({
  Boutique: { findOne: (...a) => mockFindOne(...a) },
  Produit: { findAll: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
  Categorie: {},
  Utilisateur: {},
  Avis: { findAll: jest.fn().mockResolvedValue([]) },
  LigneCommande: {},
  Commande: {},
  Favori: {},
  ProduitImage: {},
  Boutique_: {},
}));
jest.mock('../../src/config/db', () => ({
  transaction: jest.fn(),
  define: jest.fn(() => ({})),
  fn: jest.fn(),
  col: jest.fn(),
  literal: jest.fn(),
}));

const CatalogueService = require('../../src/services/catalogue/catalogue.service');

/** Une boutique en base, telle que Sequelize la rend en `plain`. */
function boutique(modifs = {}) {
  return {
    id: 'b-1',
    nom: 'Aloushop',
    slug: 'aloushop',
    vendeurId: 'v-1',
    localisation: 'Dakar',
    createdAt: new Date('2026-01-01'),
    vitrineActive: true,
    vitrineSectionsPerso: [],
    vitrineBlocs: {},
    vitrineSections: {},
    vendeur: { statutValidation: 'approuve' },
    ...modifs,
  };
}

/** Appelle le service avec cette boutique et rend la charge publique. */
async function charge(modifs) {
  const b = boutique(modifs);
  // Le service appelle `toJSON()` sur l'instance Sequelize.
  mockFindOne.mockResolvedValue({ ...b, toJSON: () => ({ ...b }) });
  const { boutique: publique } = await CatalogueService.boutique('b-1');
  return publique;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.VITRINE_BASE_URL = 'https://saambiz.com';
});

describe('Le site en ligne', () => {
  test('son adresse est renvoyee a l’acheteur', async () => {
    const p = await charge({ vitrineActive: true, slug: 'aloushop' });
    expect(p.siteUrl).toBe('https://saambiz.com/b/aloushop');
  });

  test('la base vient de la configuration, pas du code', async () => {
    process.env.VITRINE_BASE_URL = 'https://boutique.exemple.sn/';
    const p = await charge({ vitrineActive: true, slug: 'aloushop' });
    // La barre finale de la variable ne doit pas se retrouver doublee.
    expect(p.siteUrl).toBe('https://boutique.exemple.sn/b/aloushop');
  });
});

describe('Le site hors ligne', () => {
  test('aucune adresse : le lien serait mort', async () => {
    const p = await charge({ vitrineActive: false, slug: 'aloushop' });
    expect(p.siteUrl).toBeNull();
  });

  test('une boutique sans slug non plus', async () => {
    const p = await charge({ vitrineActive: true, slug: null });
    expect(p.siteUrl).toBeNull();
  });
});

describe('Ce qui ne doit pas fuir', () => {
  test('`vitrineActive` reste interne', async () => {
    // Seule l'adresse interesse l'acheteur ; l'etat de publication est un
    // detail du vendeur.
    const p = await charge({ vitrineActive: true });
    expect(p).not.toHaveProperty('vitrineActive');
  });
});
