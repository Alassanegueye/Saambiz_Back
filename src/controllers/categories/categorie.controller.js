const CategorieService = require('../../services/categories/categorie.service');
const asyncHandler = require('../../middlewares/asyncHandler');
const { NotFoundError } = require('../../errors/AppError');

class CategorieController {

  static getAllCategories = asyncHandler(async (req, res) => {
    const result = await CategorieService.getAllCategories();
    return res.status(200).json({ success: true, ...result });
  });

  static getCategorieById = asyncHandler(async (req, res) => {
    const { id } = req.params;
    // Le service signale l'absence par un message : on le traduit en 404 ici
    // plutôt que de laisser passer un 500 pour une simple erreur de saisie.
    const result = await CategorieService.getCategorieById(id).catch((err) => {
      if (err.message === 'Catégorie introuvable') throw new NotFoundError(err.message);
      throw err;
    });
    return res.status(200).json({ success: true, ...result });
  });
}

module.exports = CategorieController;
