const { Favori, Boutique, Utilisateur } = require('../../models');

class FavoriService {

  static async ajouterFavori(acheteurId, boutiqueId) {
    const [favori, created] = await Favori.findOrCreate({
      where: { acheteurId, boutiqueId }
    });
    if (!created) return { success: false, message: 'Boutique déjà en favoris' };
    return { success: true, message: 'Boutique ajoutée aux favoris', favori };
  }

  static async supprimerFavori(acheteurId, boutiqueId) {
    const deleted = await Favori.destroy({ where: { acheteurId, boutiqueId } });
    if (!deleted) return { success: false, message: 'Favori introuvable' };
    return { success: true, message: 'Boutique retirée des favoris' };
  }

  static async mesFavoris(acheteurId) {
    const favoris = await Favori.findAll({
      where: { acheteurId },
      include: [
        {
          model: Boutique,
          as: 'boutique',
          include: [{ model: Utilisateur, as: 'vendeur', attributes: ['id', 'nom', 'prenom'] }]
        }
      ],
      order: [['createdAt', 'DESC']]
    });
    return favoris;
  }

  /**
   * 🔔 Active ou désactive la cloche de notifications pour une boutique.
   * Si l'acheteur ne suit pas encore la boutique, le suivi est créé avec la cloche à l'état demandé.
   */
  static async toggleCloche(acheteurId, boutiqueId, active) {
    const [favori] = await Favori.findOrCreate({
      where: { acheteurId, boutiqueId },
      defaults: { acheteurId, boutiqueId, clocheActive: active },
    });
    if (favori.clocheActive !== active) {
      await favori.update({ clocheActive: active });
    }
    return {
      success: true,
      message: active ? 'Cloche activée 🔔' : 'Cloche désactivée 🔕',
      clocheActive: favori.clocheActive,
    };
  }

  /**
   * Retourne l'état de suivi d'une boutique pour un acheteur (suivi + cloche).
   */
  static async statutSuivi(acheteurId, boutiqueId) {
    const favori = await Favori.findOne({ where: { acheteurId, boutiqueId } });
    return {
      suivi: !!favori,
      clocheActive: favori ? favori.clocheActive : false,
    };
  }

  /**
   * Nombre d'abonnés (personnes qui suivent) d'une boutique.
   */
  static async nbAbonnes(boutiqueId) {
    return await Favori.count({ where: { boutiqueId } });
  }
}

module.exports = FavoriService;
