const { Op } = require('sequelize');
const { Categorie, BoutiqueCategorie } = require('../../models');
const { ValidationError } = require('../../errors/AppError');
const { ALIAS_CATEGORIES, MAX_CATEGORIES_BOUTIQUE } = require('../../constants/categories');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Catégories d'une boutique : 1 à 3, dont une principale (la première).
 *
 * Le vendeur peut transmettre des identifiants, des slugs ou des noms : les
 * versions précédentes de l'application envoyaient un simple libellé
 * ('Mode', 'Beauté'…) dans `categorie`, et ce champ reste accepté.
 */
class CategorieBoutiqueService {
  /**
   * Normalise ce que le client envoie en une liste de valeurs.
   * Accepte un tableau, une chaîne JSON (formulaire multipart), une liste
   * séparée par des virgules ou une valeur seule.
   */
  static lireValeurs(categories, categorie) {
    let brut = categories;
    if (typeof brut === 'string') {
      const t = brut.trim();
      if (t.startsWith('[')) {
        try { brut = JSON.parse(t); } catch { brut = [t]; }
      } else {
        brut = t ? t.split(',') : [];
      }
    }
    let valeurs = Array.isArray(brut) ? brut : [];
    if (!valeurs.length && typeof categorie === 'string' && categorie.trim()) {
      valeurs = [categorie];
    }
    return valeurs
      .map((v) => (typeof v === 'string' ? v.trim() : v))
      .filter((v) => typeof v === 'string' && v);
  }

  /**
   * Valeurs → catégories actives, dans l'ordre donné, sans doublon.
   * Une valeur inconnue est ignorée ; un ancien libellé est traduit.
   */
  static async resoudre(valeurs, { transaction } = {}) {
    if (!valeurs.length) return [];

    const ids = valeurs.filter((v) => UUID.test(v));
    const textes = valeurs.filter((v) => !UUID.test(v));
    const slugsAlias = textes.flatMap((t) => ALIAS_CATEGORIES[t.toLowerCase()] || []);

    const candidates = await Categorie.findAll({
      where: {
        active: true,
        [Op.or]: [
          ids.length ? { id: { [Op.in]: ids } } : null,
          textes.length ? { slug: { [Op.in]: textes.map((t) => t.toLowerCase()) } } : null,
          slugsAlias.length ? { slug: { [Op.in]: slugsAlias } } : null,
          ...textes.map((t) => ({ nom: { [Op.iLike]: t } })),
        ].filter(Boolean),
      },
      transaction,
    });

    const parId = new Map(candidates.map((c) => [c.id, c]));
    const parSlug = new Map(candidates.map((c) => [c.slug, c]));
    const parNom = new Map(candidates.map((c) => [c.nom.toLowerCase(), c]));

    const resultat = [];
    const vus = new Set();
    const ajouter = (c) => {
      if (c && !vus.has(c.id)) { vus.add(c.id); resultat.push(c); }
    };
    for (const v of valeurs) {
      const cle = v.toLowerCase();
      if (parId.has(v)) ajouter(parId.get(v));
      else if (parSlug.has(cle)) ajouter(parSlug.get(cle));
      else if (parNom.has(cle)) ajouter(parNom.get(cle));
      else (ALIAS_CATEGORIES[cle] || []).forEach((s) => ajouter(parSlug.get(s)));
    }
    return resultat;
  }

  /**
   * Remplace les catégories de la boutique. Sans valeur exploitable, ne
   * change rien (un formulaire qui n'envoie pas le champ ne doit pas vider
   * les catégories existantes).
   *
   * @returns {Promise<Categorie[]|null>} les catégories retenues, ou null
   */
  static async definir(boutique, { categories, categorie } = {}, { transaction } = {}) {
    const valeurs = this.lireValeurs(categories, categorie);
    if (!valeurs.length) return null;

    let retenues = await this.resoudre(valeurs, { transaction });
    // Ancien champ libre `categorie` non reconnu (ancienne version de
    // l'application) : « Autre » plutôt qu'un refus d'inscription.
    const viaAncienChamp = !this.lireValeurs(categories).length;
    if (!retenues.length && viaAncienChamp) {
      retenues = await this.resoudre(['autre'], { transaction });
    }
    if (!retenues.length) {
      throw new ValidationError('Catégorie inconnue. Choisissez parmi la liste proposée.', [
        { champ: 'categories', message: 'Aucune catégorie reconnue' },
      ]);
    }
    if (retenues.length > MAX_CATEGORIES_BOUTIQUE) {
      throw new ValidationError(
        `Choisissez au plus ${MAX_CATEGORIES_BOUTIQUE} catégories pour votre boutique.`,
        [{ champ: 'categories', message: `${MAX_CATEGORIES_BOUTIQUE} catégories maximum` }],
      );
    }

    await BoutiqueCategorie.destroy({ where: { boutiqueId: boutique.id }, transaction });
    await BoutiqueCategorie.bulkCreate(
      retenues.map((c, i) => ({ boutiqueId: boutique.id, categorieId: c.id, principale: i === 0 })),
      { transaction },
    );
    // Le texte reste aligné sur la principale : l'accueil et la vitrine le
    // lisent pour l'affichage.
    if (boutique.categorie !== retenues[0].nom) {
      await boutique.update({ categorie: retenues[0].nom }, { transaction });
    }
    return retenues;
  }

  /** Catégories d'une boutique, principale en tête. */
  static async lister(boutiqueId) {
    const liens = await BoutiqueCategorie.findAll({
      where: { boutiqueId },
      include: [{
        model: Categorie, as: 'categorie',
        attributes: ['id', 'nom', 'slug', 'icone'],
      }],
      order: [['principale', 'DESC'], ['createdAt', 'ASC']],
    });
    return liens
      .filter((l) => l.categorie)
      .map((l) => ({ ...l.categorie.toJSON(), principale: l.principale }));
  }
}

module.exports = CategorieBoutiqueService;
