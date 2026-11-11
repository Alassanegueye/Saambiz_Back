/**
 * Modifier une promotion ne doit pas permettre de la rattacher au produit
 * d'un AUTRE vendeur.
 *
 * `modifierPromotionSchema` accepte `produitId`, et le service appliquait
 * `promotion.update(data)` sans revérifier à qui appartient le nouveau
 * produit. La propriété n'était contrôlée qu'à la CRÉATION. Un vendeur
 * pouvait donc créer une promotion sur un de ses produits, puis la
 * repointer sur le produit d'un concurrent :
 *
 *   - `/promotions/actives` est public et joint le produit : une fausse
 *     promotion s'affichait sur le produit du concurrent ;
 *   - `supprimerPromotion` remet `prix_promo` à NULL sur le produit visé :
 *     la suppression effaçait le prix promotionnel du concurrent.
 */

const mockPromotionFindOne = jest.fn();
const mockProduitFindOne = jest.fn();

jest.mock('../../src/models', () => ({
  Promotion: { findOne: (...a) => mockPromotionFindOne(...a), create: jest.fn(), count: jest.fn() },
  Produit: { findOne: (...a) => mockProduitFindOne(...a), findAll: jest.fn(), update: jest.fn() },
  Boutique: { findOne: jest.fn() },
  Favori: { findAll: jest.fn() },
}));

jest.mock('../../src/services/notifications/notification.service', () => ({
  notifierAbonnesDuVendeur: jest.fn(),
  notifierUtilisateurs: jest.fn(),
}));

const PromotionService = require('../../src/services/promotions/promotion.service');

const VENDEUR_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const PRODUIT_DE_B = 'bbbbbbbb-0000-4000-8000-000000000002';

describe('modifierPromotion — propriété du produit visé', () => {
  let promotion;

  beforeEach(() => {
    promotion = {
      id: 'promo-1',
      vendeurId: VENDEUR_A,
      produitId: 'aaaaaaaa-0000-4000-8000-0000000000ff', // un produit de A
      update: jest.fn(async (data) => Object.assign(promotion, data)),
    };
    mockPromotionFindOne.mockReset().mockResolvedValue(promotion);
    mockProduitFindOne.mockReset();
  });

  it('refuse de rattacher la promotion au produit d\'un autre vendeur', async () => {
    // Le produit visé n'appartient pas au vendeur A : la recherche
    // contrainte par vendeurId ne le trouve pas.
    mockProduitFindOne.mockResolvedValue(null);

    const r = await PromotionService.modifierPromotion(promotion.id, VENDEUR_A, {
      produitId: PRODUIT_DE_B,
      prixPromo: 1,
    });

    expect(r.success).toBe(false);
    expect(promotion.update).not.toHaveBeenCalled();
    expect(promotion.produitId).not.toBe(PRODUIT_DE_B);
  });

  it('vérifie la propriété en croisant le vendeur, pas seulement l\'identifiant', async () => {
    mockProduitFindOne.mockResolvedValue(null);

    await PromotionService.modifierPromotion(promotion.id, VENDEUR_A, {
      produitId: PRODUIT_DE_B,
    });

    expect(mockProduitFindOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: PRODUIT_DE_B, vendeurId: VENDEUR_A }),
      }),
    );
  });

  it('accepte le changement vers un produit que le vendeur possède', async () => {
    const PRODUIT_DE_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
    mockProduitFindOne.mockResolvedValue({ id: PRODUIT_DE_A, vendeurId: VENDEUR_A, prix: 10000 });

    const r = await PromotionService.modifierPromotion(promotion.id, VENDEUR_A, {
      produitId: PRODUIT_DE_A,
    });

    expect(r.success).toBe(true);
    expect(promotion.update).toHaveBeenCalled();
  });

  it('laisse passer une modification qui ne touche pas au produit', async () => {
    const r = await PromotionService.modifierPromotion(promotion.id, VENDEUR_A, {
      titre: 'Nouveau titre',
    });

    expect(r.success).toBe(true);
    // Aucune vérification de produit nécessaire : le produit ne change pas.
    expect(mockProduitFindOne).not.toHaveBeenCalled();
  });
});
