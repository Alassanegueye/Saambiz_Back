const CatalogueService = require('../../services/catalogue/catalogue.service');
const asyncHandler = require('../../middlewares/asyncHandler');

/** Catalogue public : ouvert aux invités, enrichi si le client est connecté. */
exports.lister = asyncHandler(async (req, res) => {
  const { categorie, boutique, q, tri, promo, page, limit } = req.query;
  res.json({ success: true, ...(await CatalogueService.lister({ categorie, boutique, q, tri, promo, page, limit })) });
});

exports.detail = asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await CatalogueService.detail(req.params.id)) });
});

exports.promotions = asyncHandler(async (req, res) => {
  const { page, limit } = req.query;
  res.json({ success: true, ...(await CatalogueService.promotions({ page, limit })) });
});

exports.boutique = asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await CatalogueService.boutique(req.params.id)) });
});
