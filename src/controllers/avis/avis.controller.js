const AvisService = require('../../services/avis/avis.service');
const asyncHandler = require('../../middlewares/asyncHandler');
const { BadRequestError, NotFoundError } = require('../../errors/AppError');

exports.laisserAvis = asyncHandler(async (req, res) => {
  const { boutiqueId, note, commentaire } = req.body;
  if (!boutiqueId) throw new BadRequestError('boutiqueId est requis.');

  const result = await AvisService.laisserAvis(req.user.id, boutiqueId, note, commentaire);
  if (!result.success) throw new BadRequestError(result.message);
  return res.status(201).json(result);
});

exports.avisBoutique = asyncHandler(async (req, res) => {
  const result = await AvisService.avisBoutique(req.params.boutiqueId);
  return res.status(200).json(result);
});

exports.monAvis = asyncHandler(async (req, res) => {
  const avis = await AvisService.monAvis(req.user.id, req.params.boutiqueId);
  return res.status(200).json({ avis });
});

exports.supprimerAvis = asyncHandler(async (req, res) => {
  const result = await AvisService.supprimerAvis(req.user.id, req.params.boutiqueId);
  if (!result.success) throw new NotFoundError(result.message);
  return res.status(200).json(result);
});
