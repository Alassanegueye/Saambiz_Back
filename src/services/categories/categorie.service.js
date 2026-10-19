const { Op, literal } = require('sequelize');
const { Categorie, Produit } = require('../../models');
const { NotFoundError } = require('../../errors/AppError');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Boutiques visibles rangées dans la catégorie (active, vendeur actif).
// Permet à l'application de masquer une catégorie encore vide.
const NOMBRE_BOUTIQUES = literal(`(
  SELECT COUNT(*)::int
    FROM boutique_categorie bc
    JOIN boutique b    ON b.id = bc.boutique_id AND b.deleted_at IS NULL AND b.statut = 'actif'
    JOIN utilisateur u ON u.id = b.vendeur_id  AND u.statut = 'actif'
   WHERE bc.categorie_id = "Categorie"."id"
)`);

// `specifications` : formulaire produit de la catégorie (tailles, pointures…).
const ATTRIBUTS_PUBLICS = ['id', 'nom', 'slug', 'description', 'icone', 'image', 'ordre', 'specifications'];

class CategorieService {
  /** Catégories affichées dans l'application : actives, dans l'ordre choisi par l'admin. */
  static async getAllCategories() {
    const categories = await Categorie.findAll({
      where: { active: true },
      attributes: [...ATTRIBUTS_PUBLICS, [NOMBRE_BOUTIQUES, 'nombreBoutiques']],
      order: [['ordre', 'ASC'], ['nom', 'ASC']],
    });
    return { categories };
  }

  /** Une catégorie, par identifiant ou par slug. */
  static async trouver(idOuSlug, { inclureMasquees = false } = {}) {
    const where = UUID.test(String(idOuSlug))
      ? { id: idOuSlug }
      : { slug: String(idOuSlug).toLowerCase() };
    if (!inclureMasquees) where.active = true;
    const categorie = await Categorie.findOne({ where });
    if (!categorie) throw new NotFoundError('Catégorie introuvable');
    return categorie;
  }

  static async getCategorieById(idOuSlug) {
    const trouvee = await this.trouver(idOuSlug);
    const categorie = await Categorie.findByPk(trouvee.id, {
      attributes: ATTRIBUTS_PUBLICS,
      include: [
        {
          model: Produit,
          as: 'produits',
          where: { statut: 'approuve', disponible: { [Op.ne]: false } },
          required: false,
          attributes: ['id', 'nom', 'prix', 'prix_promo', 'image', 'disponible', 'vues'],
        },
      ],
    });
    return { categorie };
  }
}

module.exports = CategorieService;
