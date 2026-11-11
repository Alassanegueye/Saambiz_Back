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

    // 🔔 Les clients ne sont prévenus que si le vendeur l'a demandé, avec son
    // propre message, et seulement ceux qui ont activé la cloche.
    if (data.notifier === true && String(description || '').trim()) {
      NotificationService.notifierAbonnesDuVendeur(
        vendeurId,
        titre,
        String(description).trim().slice(0, 500),
        'promotion',
        { produitId },
        { image: data.image },
      ).catch(() => {});
    }

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
    // La requête peut arriver en multipart (avec une image) : les listes y
    // voyagent en JSON, les booléens en texte.
    const liste = (v) => {
      if (Array.isArray(v)) return v;
      if (typeof v === 'string' && v.trim().startsWith('[')) {
        try { return JSON.parse(v); } catch { return []; }
      }
      return v;
    };
    data = { ...data, produitIds: liste(data.produitIds), destinataires: liste(data.destinataires) };

    const type = data.type === 'information' ? 'information' : 'promotion';
    // Une information est faite pour être envoyée ; une promotion peut être
    // créée sans prévenir personne si le vendeur décoche « Notifier ».
    const notifier = type === 'information' || !(data.notifier === false || data.notifier === 'false');
    const titre = String(data.titre || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const message = String(data.message || '').trim().slice(0, 500);
    const image = /^https:\/\//.test(String(data.image || '')) ? String(data.image) : null;
    if (notifier && !titre) throw new BadRequestError('Donnez un titre à votre message.');
    if (notifier && !message) throw new BadRequestError('Écrivez le message à envoyer à vos clients.');

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
          titre: titre || `Promotion -${Math.round(pourcentage)} %`,
          description: message || null,
          prixPromo, produitId: produit.id, vendeurId, dateDebut: debut, dateFin: fin,
        });
        // Prix barré visible tout de suite si la promotion a déjà commencé.
        if (debut <= new Date()) await produit.update({ prix_promo: prixPromo });
        return promo;
      }));
    }

    if (!notifier) {
      return {
        success: true,
        message: `Promotion créée sur ${promotions.length} produit${promotions.length > 1 ? 's' : ''}. Aucun client n'a été notifié.`,
        promotions: promotions.length,
        destinataires: 0,
      };
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
      // L'image jointe par le vendeur (Cloudinary), sinon le logo de la boutique.
      { image: image || boutique.logo },
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

    // La propriété du produit n'était vérifiée qu'à la CRÉATION, alors que
    // `modifierPromotionSchema` accepte `produitId`. Une modification
    // pouvait donc rattacher la promotion au produit d'un autre vendeur :
    // `/promotions/actives` est public et joint le produit, la fausse
    // promotion s'affichait donc sur le produit du concurrent, et
    // `supprimerPromotion` remettait ensuite SON `prix_promo` à NULL.
    //
    // Le prix est contrôlé contre le produit réellement visé, comme à la
    // création : annoncer un « prix promotionnel » supérieur au prix
    // catalogue n'a pas de sens, et l'affichage barré devient trompeur.
    const produitVise = data.produitId || promotion.produitId;
    const changeDeProduit = data.produitId && data.produitId !== promotion.produitId;
    if (changeDeProduit || data.prixPromo != null) {
      const produit = await Produit.findOne({ where: { id: produitVise, vendeurId } });
      if (!produit) return { success: false, message: 'Produit introuvable ou accès interdit' };
      if (data.prixPromo != null && Number(data.prixPromo) >= Number(produit.prix)) {
        return { success: false, message: 'Le prix promotionnel doit être inférieur au prix du produit' };
      }
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
