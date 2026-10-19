const { Op, literal } = require('sequelize');
const sequelize = require('../../config/db');
const { Categorie, Produit } = require('../../models');
const {
  BadRequestError, ConflictError, NotFoundError,
} = require('../../errors/AppError');
const { slugifier } = require('../../constants/categories');
const { normaliserSchema } = require('./specifications');

const NOMBRE_PRODUITS = literal(`(
  SELECT COUNT(*)::int FROM produit p
   WHERE p.categorie_id = "Categorie"."id" AND p.deleted_at IS NULL
)`);
const NOMBRE_BOUTIQUES = literal(`(
  SELECT COUNT(*)::int FROM boutique_categorie bc
    JOIN boutique b ON b.id = bc.boutique_id AND b.deleted_at IS NULL
   WHERE bc.categorie_id = "Categorie"."id"
)`);

const ICONE_VALIDE = /^[a-z0-9_]{1,40}$/;

/**
 * Gestion des catégories depuis le dashboard admin.
 *
 * Les catégories sont référencées par nom à deux endroits hérités de
 * l'ancien modèle : `boutique.categorie` (libellé de la principale) et les
 * préférences clients (intérêts, affinités). Renommer ou fusionner une
 * catégorie met donc ces deux endroits à jour dans la même transaction —
 * sinon un client perdrait ses affinités au premier renommage.
 */
class CategorieAdminService {
  /** Toutes les catégories, masquées comprises, avec leur usage. */
  static async lister() {
    const categories = await Categorie.findAll({
      attributes: {
        include: [[NOMBRE_PRODUITS, 'nombreProduits'], [NOMBRE_BOUTIQUES, 'nombreBoutiques']],
      },
      order: [['ordre', 'ASC'], ['nom', 'ASC']],
    });
    return { categories };
  }

  static _nettoyer(data, { creation }) {
    const champs = {};
    if (data.nom !== undefined || creation) {
      const nom = String(data.nom || '').trim().replace(/\s+/g, ' ');
      if (!nom) throw new BadRequestError('Le nom de la catégorie est requis');
      if (nom.length > 60) throw new BadRequestError('Le nom ne doit pas dépasser 60 caractères');
      champs.nom = nom;
    }
    if (data.description !== undefined) {
      champs.description = String(data.description || '').trim().slice(0, 255) || null;
    }
    if (data.icone !== undefined) {
      const icone = String(data.icone || '').trim();
      if (icone && !ICONE_VALIDE.test(icone)) {
        throw new BadRequestError('Icône invalide (nom d\'icône Material, ex. « checkroom »)');
      }
      champs.icone = icone || null;
    }
    if (data.image !== undefined) {
      const image = String(data.image || '').trim();
      if (image && !/^https?:\/\//i.test(image)) {
        throw new BadRequestError('L\'image doit être une adresse http(s)');
      }
      champs.image = image.slice(0, 500) || null;
    }
    if (data.ordre !== undefined && data.ordre !== '' && data.ordre !== null) {
      const ordre = parseInt(data.ordre, 10);
      if (Number.isNaN(ordre) || ordre < 0) throw new BadRequestError('Ordre invalide');
      champs.ordre = ordre;
    }
    if (data.specifications !== undefined) {
      champs.specifications = normaliserSchema(data.specifications);
    }
    if (data.active !== undefined) {
      champs.active = data.active === true || data.active === 'true' || data.active === 1 || data.active === '1';
    }
    return champs;
  }

  /** Slug libre, y compris parmi les catégories supprimées (l'index les couvre). */
  static async _slugLibre(nom, { saufId, transaction } = {}) {
    const base = slugifier(nom) || 'categorie';
    let slug = base;
    for (let i = 2; ; i++) {
      const pris = await Categorie.findOne({
        where: { slug, ...(saufId ? { id: { [Op.ne]: saufId } } : {}) },
        paranoid: false,
        transaction,
      });
      if (!pris) return slug;
      slug = `${base.slice(0, 66)}-${i}`;
    }
  }

  static async creer(data) {
    const champs = this._nettoyer(data, { creation: true });

    return sequelize.transaction(async (transaction) => {
      const existante = await Categorie.findOne({
        where: { nom: { [Op.iLike]: champs.nom } },
        paranoid: false,
        transaction,
      });
      if (existante && !existante.deletedAt) {
        throw new ConflictError('Cette catégorie existe déjà');
      }

      if (champs.ordre === undefined) {
        const max = await Categorie.max('ordre', { where: { ordre: { [Op.lt]: 900 } }, transaction });
        champs.ordre = (Number(max) || 0) + 1;
      }

      // Une catégorie supprimée garde son nom réservé (unicité en base) :
      // on la ressuscite plutôt que d'échouer sur un doublon invisible.
      if (existante) {
        await existante.restore({ transaction });
        await existante.update({ active: true, ...champs }, { transaction });
        return { message: 'Catégorie créée avec succès', categorie: existante };
      }

      const slug = await this._slugLibre(champs.nom, { transaction });
      const categorie = await Categorie.create({ active: true, ...champs, slug }, { transaction });
      return { message: 'Catégorie créée avec succès', categorie };
    });
  }

  static async modifier(id, data) {
    const champs = this._nettoyer(data, { creation: false });

    return sequelize.transaction(async (transaction) => {
      const categorie = await Categorie.findByPk(id, { transaction });
      if (!categorie) throw new NotFoundError('Catégorie introuvable');

      const ancienNom = categorie.nom;
      if (champs.nom && champs.nom !== ancienNom) {
        const doublon = await Categorie.findOne({
          where: { nom: { [Op.iLike]: champs.nom }, id: { [Op.ne]: id } },
          paranoid: false,
          transaction,
        });
        if (doublon) throw new ConflictError('Ce nom de catégorie est déjà utilisé');
      }

      await categorie.update(champs, { transaction });
      if (!categorie.slug) {
        await categorie.update({ slug: await this._slugLibre(categorie.nom, { saufId: id, transaction }) }, { transaction });
      }
      if (champs.nom && champs.nom !== ancienNom) {
        await this._propagerNom(ancienNom, champs.nom, transaction);
      }
      return { message: 'Catégorie modifiée avec succès', categorie };
    });
  }

  /**
   * Supprime une catégorie. Si elle est utilisée, `remplacerPar` indique la
   * catégorie qui reprend ses produits et ses boutiques (fusion). Sans
   * remplaçant, la suppression est refusée : mieux vaut alors la masquer.
   */
  static async supprimer(id, { remplacerPar } = {}) {
    return sequelize.transaction(async (transaction) => {
      const categorie = await Categorie.findByPk(id, { transaction });
      if (!categorie) throw new NotFoundError('Catégorie introuvable');

      if (remplacerPar) {
        if (remplacerPar === id) throw new BadRequestError('Choisissez une autre catégorie de remplacement');
        const cible = await Categorie.findByPk(remplacerPar, { transaction });
        if (!cible) throw new NotFoundError('Catégorie de remplacement introuvable');

        // Produits, y compris supprimés : ils référencent encore la ligne.
        const [nbProduits] = await Produit.update(
          { categorieId: cible.id },
          { where: { categorieId: id }, paranoid: false, transaction },
        );

        // Boutiques déjà rangées dans la cible : on retire simplement l'ancien
        // lien, en transmettant le rôle de principale s'il le portait.
        const [retires] = await sequelize.query(`
          DELETE FROM boutique_categorie
           WHERE categorie_id = :ancien
             AND boutique_id IN (SELECT boutique_id FROM boutique_categorie WHERE categorie_id = :cible)
          RETURNING boutique_id, principale
        `, { replacements: { ancien: id, cible: cible.id }, transaction });
        const principales = retires.filter((r) => r.principale).map((r) => r.boutique_id);
        if (principales.length) {
          await sequelize.query(`
            UPDATE boutique_categorie SET principale = TRUE, updated_at = NOW()
             WHERE categorie_id = :cible AND boutique_id IN (:ids)
          `, { replacements: { cible: cible.id, ids: principales }, transaction });
        }
        const [, deplaces] = await sequelize.query(`
          UPDATE boutique_categorie SET categorie_id = :cible, updated_at = NOW()
           WHERE categorie_id = :ancien
        `, { replacements: { ancien: id, cible: cible.id }, transaction });

        await this._propagerNom(categorie.nom, cible.nom, transaction);
        await categorie.destroy({ transaction });
        return {
          message: `Catégorie « ${categorie.nom} » fusionnée dans « ${cible.nom} »`,
          produitsDeplaces: nbProduits,
          boutiquesDeplacees: retires.length + (deplaces?.rowCount ?? 0),
        };
      }

      const nbProduits = await Produit.count({ where: { categorieId: id }, transaction });
      const [[{ nb: nbBoutiques }]] = await sequelize.query(
        'SELECT COUNT(*)::int AS nb FROM boutique_categorie WHERE categorie_id = :id',
        { replacements: { id }, transaction },
      );
      if (nbProduits > 0 || nbBoutiques > 0) {
        throw new ConflictError(
          `Catégorie utilisée par ${nbProduits} produit(s) et ${nbBoutiques} boutique(s). `
          + 'Choisissez une catégorie de remplacement, ou masquez-la.',
        );
      }
      await categorie.destroy({ transaction });
      return { message: 'Catégorie supprimée avec succès' };
    });
  }

  /** Nouvel ordre d'affichage : la liste complète des identifiants, dans l'ordre voulu. */
  static async reordonner(ids) {
    if (!Array.isArray(ids) || !ids.length || ids.some((i) => typeof i !== 'string')) {
      throw new BadRequestError('Liste d\'identifiants attendue');
    }
    await sequelize.transaction(async (transaction) => {
      for (let i = 0; i < ids.length; i++) {
        await Categorie.update({ ordre: i + 1 }, { where: { id: ids[i] }, transaction });
      }
    });
    return { message: 'Ordre des catégories enregistré', ...(await this.lister()) };
  }

  /** Reporte un renommage sur les références par nom (boutiques, préférences). */
  static async _propagerNom(ancien, nouveau, transaction) {
    if (!ancien || ancien === nouveau) return;
    const replacements = { ancien, nouveau };

    await sequelize.query(
      'UPDATE boutique SET categorie = :nouveau WHERE categorie = :ancien',
      { replacements, transaction },
    );
    await sequelize.query(`
      UPDATE preference_client
         SET interets = (
               SELECT COALESCE(jsonb_agg(v ORDER BY pos), '[]'::jsonb)
                 FROM (
                   SELECT DISTINCT ON (v) v, pos
                     FROM (
                       SELECT CASE WHEN e = :ancien THEN CAST(:nouveau AS text) ELSE e END AS v, pos
                         FROM jsonb_array_elements_text(interets) WITH ORDINALITY AS t(e, pos)
                     ) brut
                    ORDER BY v, pos
                 ) s
             ),
             updated_at = NOW()
       WHERE jsonb_typeof(interets) = 'array' AND jsonb_exists(interets, :ancien)
    `, { replacements, transaction });
    await sequelize.query(`
      UPDATE preference_client
         SET affinites = (affinites - CAST(:ancien AS text))
                         || jsonb_build_object(
                              CAST(:nouveau AS text),
                              GREATEST(
                                COALESCE((affinites ->> CAST(:nouveau AS text))::numeric, 0),
                                COALESCE((affinites ->> CAST(:ancien AS text))::numeric, 0)
                              )
                            ),
             updated_at = NOW()
       WHERE jsonb_typeof(affinites) = 'object' AND jsonb_exists(affinites, :ancien)
    `, { replacements, transaction });
  }
}

module.exports = CategorieAdminService;
