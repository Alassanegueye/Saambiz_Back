/**
 * Expiration des promotions : la tâche doit interroger la base un nombre
 * CONSTANT de fois, pas une fois par produit.
 *
 * La version précédente lançait, pour chaque produit concerné, un `count`
 * puis éventuellement un `update`. Une fin de campagne qui expire cent
 * promotions produisait donc deux cents allers-retours, un par un, pendant
 * que la tâche tenait sa connexion.
 */

const promotions = [];
const produits = [];

jest.mock('../../src/models', () => ({
  Promotion: {
    findAll: (...a) => mockPromotionFindAll(...a),
    update: (...a) => mockPromotionUpdate(...a),
  },
  Produit: {
    update: (...a) => mockProduitUpdate(...a),
  },
}));

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const mockPromotionFindAll = jest.fn();
const mockPromotionUpdate = jest.fn();
const mockProduitUpdate = jest.fn();

const expirerPromotions = require('../../src/jobs/promotion.job');

describe('Tâche d’expiration des promotions', () => {
  beforeEach(() => {
    mockPromotionFindAll.mockReset();
    mockPromotionUpdate.mockReset().mockResolvedValue([0]);
    mockProduitUpdate.mockReset().mockResolvedValue([0]);
    promotions.length = 0;
    produits.length = 0;
  });

  it('ne fait aucune requête quand rien n’a expiré', async () => {
    mockPromotionFindAll.mockResolvedValueOnce([]);

    expect(await expirerPromotions()).toBe(0);
    expect(mockPromotionUpdate).not.toHaveBeenCalled();
    expect(mockProduitUpdate).not.toHaveBeenCalled();
  });

  it('interroge la base un nombre constant de fois, quel que soit le volume', async () => {
    // Cinquante promotions expirées sur cinquante produits distincts.
    const expirees = Array.from({ length: 50 }, (_, i) => ({
      id: `promo-${i}`,
      produitId: `prod-${i}`,
    }));
    mockPromotionFindAll
      .mockResolvedValueOnce(expirees) // 1) les expirées
      .mockResolvedValueOnce([]); // 2) celles qui restent actives

    expect(await expirerPromotions()).toBe(50);

    // Deux lectures et deux écritures. Pas cinquante.
    expect(mockPromotionFindAll).toHaveBeenCalledTimes(2);
    expect(mockPromotionUpdate).toHaveBeenCalledTimes(1);
    expect(mockProduitUpdate).toHaveBeenCalledTimes(1);
  });

  it('épargne les produits qui gardent une promotion active', async () => {
    mockPromotionFindAll
      .mockResolvedValueOnce([
        { id: 'p1', produitId: 'prod-1' },
        { id: 'p2', produitId: 'prod-2' },
      ])
      // prod-1 a encore une autre promotion en cours.
      .mockResolvedValueOnce([{ produitId: 'prod-1' }]);

    await expirerPromotions();

    const where = mockProduitUpdate.mock.calls[0][1].where;
    expect(where.id).toEqual(['prod-2']);
    expect(where.id).not.toContain('prod-1');
  });

  it('n’écrit rien si tous les produits gardent une promotion', async () => {
    mockPromotionFindAll
      .mockResolvedValueOnce([{ id: 'p1', produitId: 'prod-1' }])
      .mockResolvedValueOnce([{ produitId: 'prod-1' }]);

    await expirerPromotions();

    expect(mockProduitUpdate).not.toHaveBeenCalled();
  });
});
