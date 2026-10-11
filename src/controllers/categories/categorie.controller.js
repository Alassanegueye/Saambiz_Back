const CategorieService = require('../../services/categories/categorie.service');
const asyncHandler = require('../../middlewares/asyncHandler');

class CategorieController {

  static getAllCategories = asyncHandler(async (req, res) => {
    const result = await CategorieService.getAllCategories();
    return res.status(200).json({ success: true, ...result });
  });

  static getCategorieById = asyncHandler(async (req, res) => {
    const { id } = req.params;
    // Le service lève lui-même un NotFoundError : le 404 part tel quel vers
    // errorHandler. L'ancienne traduction comparait le texte du message, et
    // une simple reformulation côté service redonnait un 500.
    const result = await CategorieService.getCategorieById(id);
    return res.status(200).json({ success: true, ...result });
  });
}

module.exports = CategorieController;
