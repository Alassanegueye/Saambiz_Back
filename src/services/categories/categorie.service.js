const { Categorie, Produit } = require('../../models');

class CategorieService {

  static async getAllCategories() {
    const categories = await Categorie.findAll({
      order: [['nom', 'ASC']],
    });
    return { categories };
  }

  static async getCategorieById(id) {
    const categorie = await Categorie.findByPk(id, {
      include: [
        {
          model: Produit,
          as: 'produits',
          where: { statut: 'approuve' },
          required: false,
          attributes: ['id', 'nom', 'prix', 'image', 'disponible', 'vues'],
        }
      ]
    });
    if (!categorie) throw new Error('Catégorie introuvable');
    return { categorie };
  }
}

module.exports = CategorieService;
