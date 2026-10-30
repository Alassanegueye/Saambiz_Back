const { Promotion, Produit, Boutique, Favori } = require('../../models');
const { BadRequestError, NotFoundError } = require('../../errors/AppError');
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

  /**
   * Campagne envoyée par le vendeur à ses abonnés :
   *  - « promotion » : une remise (en %) sur un ou plusieurs produits, pour
   *    une durée donnée, avec un message ;
   *  - « information » : un simple message (boutique ouverte, nouveaux
   *    produits, ou ce que le vendeur veut).
   * Destinataires : tous les abonnés, ou ceux que le vendeur a choisis — et
   * dans tous les cas seulement ceux qui ont activé la cloche de la boutique.
   */
  static async creerCampagne(vendeurId, data = {}) {
    const type = data.type === 'information' ? 'information' : 'promotion';
    const titre = String(data.titre || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const message = String(data.message || '').trim().slice(0, 500);
    if (!titre) throw new BadRequestError('Donnez un titre à votre message.');
    if (!message) throw new BadRequestError('Écrivez le message à envoyer à vos clients.');

    const boutique = await Boutique.findOne({ where: { vendeurId }, attributes: ['id', 'nom', 'logo'] });
    if (!boutique) throw new NotFoundError('Créez d\'abord votre boutique.');

    // ── Promotion : une remise par produit choisi ─────────────────────
    let promotions = [];
    if (type === 'promotion') {
      const ids = [...new Set((Array.isArray(data.produitIds) ? data.produitIds : []).map(String))]
        .filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 100);
      if (!ids.length) throw new BadRequestError('Choisissez au moins un produit en promotion.');
      const pourcentage = Number(data.pourcentage);
      if (!Number.isFinite(pourcentage) || pourcentage < 1 || pourcentage > 90) {
        throw new BadRequestError('La remise doit être comprise entre 1 et 90 %.');
      }
      const debut = data.dateDebut ? new Date(data.dateDebut) : new Date();
      const fin = data.dateFin
        ? new Date(data.dateFin)
        : new Date(debut.getTime() + Math.max(1, Math.min(Number(data.dureeJours) || 7, 365)) * 864e5);
      if (Number.isNaN(debut.getTime()) || Number.isNaN(fin.getTime()) || fin <= debut) {
        throw new BadRequestError('La fin de la promotion doit être après son début.');
      }

      const produits = await Produit.findAll({ where: { id: ids, vendeurId } });
      if (!produits.length) throw new BadRequestError('Produits introuvables.');
      promotions = await Promise.all(produits.map(async (produit) => {
        const prixPromo = Math.max(1, Math.round(Number(produit.prix) * (1 - pourcentage / 100)));
        const promo = await Promotion.create({
          titre, description: message, prixPromo, produitId: produit.id, vendeurId, dateDebut: debut, dateFin: fin,
        });
        // Prix barré visible tout de suite si la promotion a déjà commencé.
        if (debut <= new Date()) await produit.update({ prix_promo: prixPromo });
        return promo;
      }));
    }

    // ── Destinataires : abonnés avec la cloche activée ────────────────
    const where = { boutiqueId: boutique.id, clocheActive: true };
    if (data.destinataires !== 'tous') {
      const choisis = (Array.isArray(data.destinataires) ? data.destinataires : []).map(String).slice(0, 5000);
      if (!choisis.length) throw new BadRequestError('Choisissez au moins un client, ou « Tous mes abonnés ».');
      where.acheteurId = choisis;
    }
    const abonnes = await Favori.findAll({ where, attributes: ['acheteurId'] });
    const destinataires = abonnes.map((a) => a.acheteurId);

    await NotificationService.notifierUtilisateurs(
      destinataires,
      `${boutique.nom} : ${titre}`,
      message,
      type === 'promotion' ? 'promotion' : 'annonce',
      {
        boutiqueId: boutique.id,
        ...(promotions.length === 1 ? { produitId: promotions[0].produitId } : {}),
      },
      { image: boutique.logo },
    );

    return {
      success: true,
      message: destinataires.length
        ? `Envoyé à ${destinataires.length} client${destinataires.length > 1 ? 's' : ''}.`
        : (promotions.length ? 'Promotion créée. Aucun abonné n\'a activé la cloche : personne n\'a été notifié.' : 'Aucun abonné n\'a activé la cloche : personne n\'a été notifié.'),
      promotions: promotions.length,
      destinataires: destinataires.length,
    };
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
