const { Favori, Boutique, Utilisateur } = require('../../models');
const { paginate, metaPagination } = require('../../utils/paginate');
const echecIgnore = require('../../utils/echecIgnore');

class FavoriService {

  static async ajouterFavori(acheteurId, boutiqueId) {
    // Suivre n'abonne pas aux notifications : le client active la cloche
    // s'il veut être prévenu des nouveautés et promotions de la boutique.
    const [favori, created] = await Favori.findOrCreate({
      where: { acheteurId, boutiqueId },
      defaults: { acheteurId, boutiqueId, clocheActive: false },
    });
    if (!created) return { success: false, message: 'Boutique déjà en favoris' };

    // Le vendeur voit sa boutique gagner des abonnés sans jamais l'apprendre.
    // C'est le signal le moins coûteux à envoyer et le plus encourageant à
    // recevoir : quelqu'un a choisi de suivre ce qu'il fait.
    FavoriService._prevenirVendeur(acheteurId, boutiqueId).catch(echecIgnore('alerte nouvel abonné au vendeur'));

    return { success: true, message: 'Boutique ajoutée aux favoris', favori };
  }

  /** « Moussa suit votre boutique » — au vendeur, jamais à l'acheteur. */
  static async _prevenirVendeur(acheteurId, boutiqueId) {
    const boutique = await Boutique.findByPk(boutiqueId, {
      attributes: ['id', 'nom', 'vendeurId'],
    });
    // Un vendeur qui suit sa propre boutique ne se notifie pas lui-même.
    if (!boutique?.vendeurId || boutique.vendeurId === acheteurId) return;

    const acheteur = await Utilisateur.findByPk(acheteurId, {
      attributes: ['prenom', 'nom'],
    });
    const nom = acheteur
      ? `${acheteur.prenom || ''} ${acheteur.nom || ''}`.trim()
      : '';

    const NotificationService = require('../notifications/notification.service');
    await NotificationService.creerNotification({
      utilisateurId: boutique.vendeurId,
      titre: 'Nouvel abonné',
      message: `${nom || 'Un client'} suit maintenant ${boutique.nom}.`,
      type: 'systeme',
      data: { ecran: 'abonnes', pourVendeur: true },
    });
  }

  static async supprimerFavori(acheteurId, boutiqueId) {
    const deleted = await Favori.destroy({ where: { acheteurId, boutiqueId } });
    if (!deleted) return { success: false, message: 'Favori introuvable' };
    return { success: true, message: 'Boutique retirée des favoris' };
  }

  static async mesFavoris(acheteurId, { page, limit } = {}) {
    const { page: p, limit: l, offset } = paginate(page, limit);
    const { rows, count } = await Favori.findAndCountAll({
      where: { acheteurId },
      include: [
        {
          model: Boutique,
          as: 'boutique',
          include: [{ model: Utilisateur, as: 'vendeur', attributes: ['id', 'nom', 'prenom'] }]
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: l,
      offset,
      // Les boutiques jointes gonfleraient le compte sans ça.
      distinct: true,
    });
    return { favoris: rows, ...metaPagination(count, p, l) };
  }

  /**
   * Active ou désactive la cloche de notifications pour une boutique.
   * Si l'acheteur ne suit pas encore la boutique, le suivi est créé avec la cloche à l'état demandé.
   */
  static async toggleCloche(acheteurId, boutiqueId, active) {
    // Éteindre la cloche d'une boutique non suivie ne doit pas créer de suivi.
    if (!active) {
      const existant = await Favori.findOne({ where: { acheteurId, boutiqueId } });
      if (!existant) {
        return { success: true, message: 'Cloche désactivée 🔕', clocheActive: false };
      }
    }
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
