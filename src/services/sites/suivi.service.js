// services/sites/suivi.service.js
//
// La fréquentation d'un site vitrine (kodafrik.com, saambiz.com) : le site
// envoie discrètement (navigator.sendBeacon) chaque page vue, le temps passé
// et les clics qui comptent (WhatsApp, téléphone, e-mail, devis).
//
//   POST /sites/:site/evenements   { s, t: "page"|"duree"|"clic", c, … }  → 204
//
// Même principe que les visites des boutiques (services/visites) : rien qui
// identifie la personne. Ni cookie ni identifiant durable — la visite a un
// numéro tiré au hasard par l'onglet, oublié à sa fermeture ; le visiteur est
// compté pour la journée par une empreinte salée (adresse + navigateur + sel
// du jour), impossible à suivre d'un jour à l'autre. Les robots ne comptent
// pas. Tout est best-effort : un compteur ne doit jamais faire échouer une
// page.

const crypto = require('crypto');
const sequelize = require('../../config/db');
const logger = require('../../utils/logger');
const VisiteService = require('../visites/visite.service');
const { siteConnu } = require('./sites.config');
const { texte, lireAgent, lireSource, lirePays, ipAnonyme } = require('./visiteur');

const TYPES = new Set(['page', 'duree', 'clic']);
const NUMERO_VISITE = /^[A-Za-z0-9_-]{8,40}$/;
const SIX_HEURES_MS = 6 * 3600 * 1000;

// Le sel du jour, gardé en mémoire : une lecture en base par jour et par
// processus au lieu d'une par page vue.
const selsEnMemoire = new Map();

/** Jour calendaire en UTC, qui est l'heure de Dakar. */
const jourDe = (date) => date.toISOString().slice(0, 10);

class SuiviService {
  /**
   * Le sel du jour : tiré au sort une fois, partagé par tous les processus
   * (en base), et effacé le lendemain — d'où l'impossibilité de rapprocher
   * deux journées.
   */
  static async selDuJour(jour) {
    if (selsEnMemoire.has(jour)) return selsEnMemoire.get(jour);
    const propose = crypto.randomBytes(16).toString('hex');
    await sequelize.query(
      'INSERT INTO site_sel (jour, valeur) VALUES (:jour, :valeur) ON CONFLICT (jour) DO NOTHING',
      { replacements: { jour, valeur: propose } },
    );
    const [ligne] = await sequelize.query(
      'SELECT valeur FROM site_sel WHERE jour = :jour',
      { replacements: { jour }, type: sequelize.QueryTypes.SELECT },
    );
    await sequelize.query('DELETE FROM site_sel WHERE jour < :jour', { replacements: { jour } });
    const valeur = String(ligne?.valeur || propose).trim();
    selsEnMemoire.clear();
    selsEnMemoire.set(jour, valeur);
    return valeur;
  }

  /** Empreinte du visiteur pour la journée (20 caractères hexadécimaux). */
  static empreinte(sel, ip, userAgent) {
    return crypto.createHash('sha256').update(`${sel}|${ip || ''}|${userAgent || ''}`).digest('hex').slice(0, 20);
  }

  /** Le corps envoyé par le site : JSON, en texte brut (sendBeacon) ou déjà lu. */
  static lireCorps(corps) {
    if (corps && typeof corps === 'object' && !Buffer.isBuffer(corps)) return corps;
    const brut = Buffer.isBuffer(corps) ? corps.toString('utf8') : String(corps || '');
    if (!brut || brut.length > 8000) return null;
    try {
      const d = JSON.parse(brut);
      return d && typeof d === 'object' && !Array.isArray(d) ? d : null;
    } catch {
      return null;
    }
  }

  /**
   * Enregistre un événement. Renvoie `true` s'il est gardé, `false` sinon
   * (robot, site inconnu, données invalides, panne). Ne lève jamais.
   */
  static async enregistrer(idSite, corps, { ip, userAgent, entetes = {}, maintenant = new Date() } = {}) {
    try {
      const site = siteConnu(idSite);
      if (!site) return false;
      if (VisiteService.estUnRobot(userAgent)) return false;

      const d = SuiviService.lireCorps(corps);
      if (!d) return false;
      const type = texte(d.t, 10);
      if (!TYPES.has(type)) return false;
      const visite = texte(d.s, 40);
      if (!visite || !NUMERO_VISITE.test(visite)) return false;

      let chemin = texte(d.c, 300);
      if (chemin !== null && !chemin.startsWith('/')) chemin = null;
      const brute = Number(d.v);
      const valeur = d.v !== undefined && d.v !== null && Number.isFinite(brute)
        ? Math.max(0, Math.min(Math.round(brute), SIX_HEURES_MS))
        : null;

      const langue = texte(d.l, 20);
      const referent = texte(d.r, 500);
      const utm = d.u && typeof d.u === 'object' ? d.u : {};
      const utmSource = texte(utm.source, 80);
      const { appareil, navigateur, os } = lireAgent(userAgent);
      const jour = jourDe(maintenant);
      const sel = await SuiviService.selDuJour(jour);

      await sequelize.query(
        `INSERT INTO site_evenement (site, cree_le, jour, type, visite, visiteur, chemin, titre, cible, valeur, entree,
           source, referent, utm_source, utm_medium, utm_campagne, appareil, navigateur, os, ecran, langue, pays, fuseau, ip_anonyme)
         VALUES (:site, :creeLe, :jour, :type, :visite, :visiteur, :chemin, :titre, :cible, :valeur, :entree,
           :source, :referent, :utmSource, :utmMedium, :utmCampagne, :appareil, :navigateur, :os, :ecran, :langue, :pays, :fuseau, :ipAnonyme)`,
        {
          replacements: {
            site: site.id,
            creeLe: maintenant,
            jour,
            type,
            visite,
            visiteur: SuiviService.empreinte(sel, ip, userAgent),
            chemin,
            titre: texte(d.ti, 200),
            cible: texte(d.ci, 120),
            valeur,
            entree: Boolean(d.e),
            source: lireSource(referent, utmSource, site.domaine),
            referent,
            utmSource,
            utmMedium: texte(utm.medium, 80),
            utmCampagne: texte(utm.campagne, 120),
            appareil,
            navigateur,
            os,
            ecran: texte(d.sc, 20),
            langue,
            pays: lirePays(langue, entetes),
            fuseau: texte(d.f, 60),
            ipAnonyme: ipAnonyme(ip),
          },
        },
      );
      return true;
    } catch (err) {
      logger.warn('[sites] événement non compté', { message: err.message });
      return false;
    }
  }
}

module.exports = SuiviService;
