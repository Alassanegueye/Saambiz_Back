const PromotionService = require('../../services/promotions/promotion.service');
const asyncHandler = require('../../middlewares/asyncHandler');
const { BadRequestError, NotFoundError } = require('../../errors/AppError');

exports.creerPromotion = asyncHandler(async (req, res) => {
  const result = await PromotionService.creerPromotion(req.user.id, req.body);
  if (!result.success) throw new BadRequestError(result.message);
  return res.status(201).json(result);
});

exports.modifierPromotion = asyncHandler(async (req, res) => {
  const result = await PromotionService.modifierPromotion(req.params.id, req.user.id, req.body);
  if (!result.success) {
    // Une promotion qui n'existe pas (ou qui appartient à un autre vendeur)
    // n'est pas la même erreur qu'un contenu refusé.
    if (result.message.includes('introuvable')) throw new NotFoundError(result.message);
    throw new BadRequestError(result.message);
  }
  return res.status(200).json(result);
});

exports.supprimerPromotion = asyncHandler(async (req, res) => {
  const result = await PromotionService.supprimerPromotion(req.params.id, req.user.id);
  if (!result.success) throw new NotFoundError(result.message);
  return res.status(200).json(result);
});

exports.mesPromotions = asyncHandler(async (req, res) => {
  const promotions = await PromotionService.mesPromotions(req.user.id);
  return res.status(200).json({ promotions });
});

exports.getPromotionsActives = asyncHandler(async (req, res) => {
  const promotions = await PromotionService.getPromotionsActives();
  return res.status(200).json({ promotions });
});
