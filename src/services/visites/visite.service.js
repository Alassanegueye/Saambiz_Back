const crypto = require('crypto');
const sequelize = require('../../config/db');
const { Boutique, Produit } = require('../../models');
// Chargé ici pour que sequelize.sync() connaisse la table en développement ;
// la migration 20261117_visites_boutique.sql la crée en production.
require('../../models/visiteBoutique.model');
const logger = require('../../utils/logger');

/**
 * Visites des boutiques et vues des produits : UNE définition pour tout.
 *
 * Avant, deux compteurs portaient le même nom à l'écran : « Visites » sur le
 * tableau de bord additionnait les vues des produits, « visites » sur Ma
 * boutique comptait chaque chargement de la page d'accueil du site. Le
 * vendeur lisait 0 d'un côté et 9 de l'autre pour la même boutique.
 *
 * Une VISITE, désormais : une personne qui ouvre la boutique, dans
 * l'application ou sur son site, comptée une fois par jour. Le vendeur
 * lui-même et les robots ne comptent pas. `boutique.vitrine_vues` reste le
 * total (sans repartir de zéro) et n'avance plus que d'une visite nouvelle ;
 * la table `visite_boutique` donne le détail par jour.
 *
 * Une VUE DE PRODUIT : une ouverture de fiche, hors vendeur et robots.
 *
 * Tout est best-effort : un compteur ne doit jamais faire échouer une page.
 */

// Aperçus de liens, robots d'indexation, outils en ligne de commande. Le
// client de l'application (« Dart/3.x (dart:io) ») n'en fait pas partie.
const ROBOTS = /bot|crawl|spider|slurp|facebookexternalhit|preview|whatsapp|telegram|discord|curl|wget|python-requests|headless|lighthouse|pingdom|uptime/i;

/** Identifiant anonyme envoyé par l'application (`X-Visiteur`). */
const IDENTIFIANT_APPAREIL = /^[0-9a-f]{16,64}$/i;

const UN_JOUR = 24 * 60 * 60 * 1000;

class VisiteService {
  static estUnRobot(userAgent) {
    return !userAgent || ROBOTS.test(String(userAgent));
  }

  /** Identifiant d'appareil valide, ou null. */
  static identifiantAppareil(valeur) {
    const v = String(valeur || '').trim();
    return IDENTIFIANT_APPAREIL.test(v) ? v.toLowerCase() : null;
  }

  /**
   * Empreinte du visiteur pour une boutique : son compte s'il est connecté,
   * sinon l'identifiant de son appareil, sinon son adresse et son
   * navigateur. Hachée avec la boutique : rien d'identifiant n'est conservé,
   * et la même personne n'a pas la même empreinte d'une boutique à l'autre.
   */
  static empreinte({ boutiqueId, utilisateurId, appareil, ip, userAgent }) {
    const qui = utilisateurId
      ? `u:${utilisateurId}`
      : appareil
        ? `d:${appareil}`
        : `a:${ip || '?'}|${userAgent || '?'}`;
    return crypto.createHash('sha256').update(`${boutiqueId}|${qui}`).digest('hex');
  }

  /** Jour calendaire en UTC, qui est l'heure de Dakar. */
  static jour(date = new Date()) {
    return date.toISOString().slice(0, 10);
  }

  /**
   * Compte une visite de boutique. Renvoie `true` si elle est nouvelle (le
   * total avance), `false` sinon : déjà venue aujourd'hui, vendeur, robot,
   * ou erreur. Ne lève jamais.
   */
  static async enregistrer({
    boutiqueId,
    vendeurId,
    canal,
    utilisateurId,
    appareil,
    ip,
    userAgent,
    maintenant = new Date(),
  }) {
    try {
      if (!boutiqueId) return false;
      if (utilisateurId && vendeurId && String(utilisateurId) === String(vendeurId)) return false;
      if (VisiteService.estUnRobot(userAgent)) return false;

      const [lignes] = await sequelize.query(
        `INSERT INTO visite_boutique (boutique_id, jour, visiteur, canal, created_at)
         VALUES (:boutiqueId, :jour, :visiteur, :canal, now())
         ON CONFLICT (boutique_id, jour, visiteur) DO NOTHING
         RETURNING id`,
        {
          replacements: {
            boutiqueId,
            jour: VisiteService.jour(maintenant),
            visiteur: VisiteService.empreinte({ boutiqueId, utilisateurId, appareil, ip, userAgent }),
            canal: canal === 'app' ? 'app' : 'site',
          },
        },
      );
      if (!Array.isArray(lignes) || lignes.length === 0) return false;

      await Boutique.increment('vitrineVues', { where: { id: boutiqueId } });
      return true;
    } catch (err) {
      logger.warn('[visites] visite non comptée', { message: err.message });
      return false;
    }
  }

  /**
   * Visites uniques récentes d'une boutique : aujourd'hui, sur 7 jours et
   * sur 30 jours (jour courant compris).
   */
  static async recentes(boutiqueId, maintenant = new Date()) {
    const vide = { aujourdHui: 0, septJours: 0, trenteJours: 0 };
    if (!boutiqueId) return vide;
    try {
      const ilYa = (n) => VisiteService.jour(new Date(maintenant.getTime() - n * UN_JOUR));
      const [ligne] = await sequelize.query(
        `SELECT COUNT(*) FILTER (WHERE jour = :aujourdhui) AS aujourdhui,
                COUNT(*) FILTER (WHERE jour >= :sept) AS sept,
                COUNT(*) AS trente
           FROM visite_boutique
          WHERE boutique_id = :boutiqueId AND jour >= :trente`,
        {
          replacements: {
            boutiqueId,
            aujourdhui: VisiteService.jour(maintenant),
            sept: ilYa(6),
            trente: ilYa(29),
          },
          type: sequelize.QueryTypes.SELECT,
        },
      );
      return {
        aujourdHui: Number(ligne?.aujourdhui) || 0,
        septJours: Number(ligne?.sept) || 0,
        trenteJours: Number(ligne?.trente) || 0,
      };
    } catch (err) {
      logger.warn('[visites] détail indisponible', { message: err.message });
      return vide;
    }
  }

  /**
   * Compte l'ouverture d'une fiche produit, hors vendeur et robots.
   * Renvoie `true` si la vue est comptée. Ne lève jamais.
   */
  static async compterVueProduit({ produitId, vendeurId, utilisateurId, userAgent }) {
    try {
      if (!produitId) return false;
      if (utilisateurId && vendeurId && String(utilisateurId) === String(vendeurId)) return false;
      if (VisiteService.estUnRobot(userAgent)) return false;
      await Produit.increment('vues', { where: { id: produitId } });
      return true;
    } catch (err) {
      logger.warn('[visites] vue de produit non comptée', { message: err.message });
      return false;
    }
  }
}

module.exports = VisiteService;
