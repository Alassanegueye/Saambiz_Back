const { Promotion, Produit } = require('../../models');
const { Op } = require('sequelize');
const NotificationService = require('../notifications/notification.service');

class PromotionService {

  static async creerPromotion(vendeurId, data) {
    const { titre, description, produitId, dateDebut, dateFin, pourcentage } = data;
    let { prixPromo } = data;

    if (new Date(dateDebut) >= new Date(dateFin)) {
      return { success: false, message: 'La date de début doit être antérieure à la date de fin' };
    }

    const produit = await Produit.findOne({ where: { id: produitId, vendeurId } });
    if (!produit) return { success: false, message: 'Produit introuvable ou accès interdit' };

    // Rabais en pourcentage → calcul du prix promo à partir du prix du produit
    if (!prixPromo && pourcentage) {
      prixPromo = Math.round(Number(produit.prix) * (1 - pourcentage / 100));
    }
    if (!prixPromo || Number(prixPromo) >= Number(produit.prix)) {
      return { success: false, message: 'Le prix promotionnel doit être inférieur au prix du produit' };
    }

    const promotion = await Promotion.create({ titre, description, prixPromo, produitId, vendeurId, dateDebut, dateFin });

    // Reflète le prix barré sur le produit pour l'affichage marketplace
    await produit.update({ prix_promo: prixPromo });

    // 🔔 Notifie les abonnés de la boutique ayant activé la cloche
    const remise = Math.round((1 - prixPromo / Number(produit.prix)) * 100);
    NotificationService.notifierAbonnesDuVendeur(
      vendeurId,
      `🔥 Promo : ${produit.nom}`,
      `${titre} — -${remise}% sur "${produit.nom}"`,
      'promotion',
      { produitId }
    ).catch(() => {});

    return { success: true, message: 'Promotion créée', promotion };
  }

  static async modifierPromotion(promotionId, vendeurId, data) {
    const promotion = await Promotion.findOne({ where: { id: promotionId, vendeurId } });
    if (!promotion) return { success: false, message: 'Promotion introuvable ou accès interdit' };

    if (data.dateDebut && data.dateFin && new Date(data.dateDebut) >= new Date(data.dateFin)) {
      return { success: false, message: 'La date de début doit être antérieure à la date de fin' };
    }

    await promotion.update(data);
    return { success: true, message: 'Promotion modifiée', promotion };
  }

  static async supprimerPromotion(promotionId, vendeurId) {
    const promotion = await Promotion.findOne({ where: { id: promotionId, vendeurId } });
    if (!promotion) return { success: false, message: 'Promotion introuvable ou accès interdit' };

    const produitId = promotion.produitId;
    await promotion.destroy();

    // Retire le prix barré du produit s'il n'a plus aucune promo active
    const encoreEnPromo = await Promotion.count({
      where: { produitId, active: true, dateFin: { [Op.gte]: new Date() } },
    });
    if (!encoreEnPromo) {
      await Produit.update({ prix_promo: null }, { where: { id: produitId } });
    }

    return { success: true, message: 'Promotion supprimée' };
  }

  static async mesPromotions(vendeurId) {
    const promotions = await Promotion.findAll({
      where: { vendeurId },
      include: [{ model: Produit, as: undefined }],
      order: [['createdAt', 'DESC']]
    });
    return promotions;
  }

  static async getPromotionsActives() {
    const promotions = await Promotion.findAll({
      where: {
        active: true,
        dateFin: { [Op.gte]: new Date() }
      },
      include: [{ model: Produit, as: undefined }],
      order: [['dateDebut', 'DESC']]
    });
    return promotions;
  }
}

module.exports = PromotionService;
