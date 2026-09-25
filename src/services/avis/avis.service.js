const { fn, col } = require('sequelize');
const { Avis, Boutique, Utilisateur } = require('../../models');

class AvisService {
  /**
   * Laisse (ou met à jour) l'avis d'un acheteur sur une boutique.
   * Un acheteur ne peut avoir qu'un seul avis par boutique.
   */
  static async laisserAvis(acheteurId, boutiqueId, note, commentaire) {
    const n = parseInt(note, 10);
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      return { success: false, message: 'La note doit être un entier entre 1 et 5.' };
    }

    const boutique = await Boutique.findByPk(boutiqueId, { attributes: ['id'] });
    if (!boutique) return { success: false, message: 'Boutique introuvable.' };

    const [avis, created] = await Avis.findOrCreate({
      where: { acheteurId, boutiqueId },
      defaults: { acheteurId, boutiqueId, note: n, commentaire: commentaire || null },
    });
    if (!created) {
      await avis.update({ note: n, commentaire: commentaire || null });
    }

    const stats = await this.statsBoutique(boutiqueId);
    return {
      success: true,
      message: created ? 'Avis publié' : 'Avis mis à jour',
      avis,
      ...stats,
    };
  }

  /** Note moyenne + nombre d'avis d'une boutique. */
  static async statsBoutique(boutiqueId) {
    const row = await Avis.findOne({
      attributes: [
        [fn('AVG', col('note')), 'moyenne'],
        [fn('COUNT', col('id')), 'total'],
      ],
      where: { boutiqueId },
      raw: true,
    });
    const total = parseInt(row?.total || 0, 10);
    const moyenne = total > 0 ? Math.round(parseFloat(row.moyenne) * 10) / 10 : 0;
    return { moyenne, total };
  }

  /** Liste des avis d'une boutique + moyenne + total. */
  static async avisBoutique(boutiqueId) {
    const avis = await Avis.findAll({
      where: { boutiqueId },
      include: [{ model: Utilisateur, as: 'acheteur', attributes: ['id', 'nom', 'prenom', 'photoProfil'] }],
      order: [['createdAt', 'DESC']],
    });
    const stats = await this.statsBoutique(boutiqueId);
    return { ...stats, avis };
  }

  /** Avis de l'acheteur connecté pour une boutique (pré-remplir le formulaire). */
  static async monAvis(acheteurId, boutiqueId) {
    return Avis.findOne({ where: { acheteurId, boutiqueId } });
  }

  static async supprimerAvis(acheteurId, boutiqueId) {
    const deleted = await Avis.destroy({ where: { acheteurId, boutiqueId } });
    if (!deleted) return { success: false, message: 'Avis introuvable' };
    return { success: true, message: 'Avis supprimé' };
  }

  /**
   * Moyennes + totaux pour un lot de boutiques (une seule requête).
   * Utilisé pour injecter `note` / `nombreAvis` dans les listings de boutiques.
   * @returns {Object} { [boutiqueId]: { moyenne, total } }
   */
  static async moyennesPourBoutiques(boutiqueIds = []) {
    if (!boutiqueIds.length) return {};
    const rows = await Avis.findAll({
      attributes: [
        'boutiqueId',
        [fn('AVG', col('note')), 'moyenne'],
        [fn('COUNT', col('id')), 'total'],
      ],
      where: { boutiqueId: boutiqueIds },
      group: ['boutiqueId'],
      raw: true,
    });
    const map = {};
    for (const r of rows) {
      const total = parseInt(r.total, 10);
      map[r.boutiqueId] = {
        moyenne: total > 0 ? Math.round(parseFloat(r.moyenne) * 10) / 10 : 0,
        total,
      };
    }
    return map;
  }
}

module.exports = AvisService;
