jest.mock('../../src/models', () => ({
  Boutique: { findAndCountAll: jest.fn() },
  Utilisateur: {}, Produit: {}, Categorie: {}, Avis: {}, Promotion: {}, ProduitImage: {},
}));
jest.mock('../../src/services/categories/categorie.service', () => ({}));

const { Op } = require('sequelize');
const { Boutique } = require('../../src/models');
const CatalogueService = require('../../src/services/catalogue/catalogue.service');

/** Liste et recherche de boutiques (accueil, onglet Boutiques). */
describe('CatalogueService.rechercherBoutiques', () => {
  const ligne = (id, statutValidation) => ({
    toJSON: () => ({ id, nom: `Boutique ${id}`, vendeur: { statutValidation } }),
  });

  beforeEach(() => {
    Boutique.findAndCountAll.mockReset();
    Boutique.findAndCountAll.mockResolvedValue({ rows: [ligne('a', 'approuve'), ligne('b', 'en_attente')], count: 25 });
  });

  test('sans recherche : toutes les boutiques, les plus récentes d\'abord', async () => {
    const res = await CatalogueService.rechercherBoutiques({ limit: 20 });
    const options = Boutique.findAndCountAll.mock.calls[0][0];
    expect(options.where[Op.or]).toBeUndefined();
    expect(options.order).toEqual([['createdAt', 'DESC']]);
    expect(res).toMatchObject({ total: 25, page: 1, pages: 2 });
  });

  test('avec recherche : filtre par nom, slogan, catégorie, ville', async () => {
    await CatalogueService.rechercherBoutiques({ q: '  tissu ' });
    const options = Boutique.findAndCountAll.mock.calls[0][0];
    expect(options.where[Op.or]).toHaveLength(4);
    expect(options.where[Op.or][0].nom[Op.iLike]).toBe('%tissu%');
    expect(options.order).toEqual([['nom', 'ASC']]);
  });

  test('pagination bornée et décalage', async () => {
    await CatalogueService.rechercherBoutiques({ limit: 500, page: '3' });
    const options = Boutique.findAndCountAll.mock.calls[0][0];
    expect(options.limit).toBe(30);
    expect(options.offset).toBe(60);
  });

  test('vendeur approuvé = boutique vérifiée, sans exposer le vendeur', async () => {
    const { boutiques } = await CatalogueService.rechercherBoutiques({});
    expect(boutiques[0]).toEqual({ id: 'a', nom: 'Boutique a', verifiee: true });
    expect(boutiques[1].verifiee).toBe(false);
    expect(boutiques[1].vendeur).toBeUndefined();
  });
});
