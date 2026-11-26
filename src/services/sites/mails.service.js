// services/sites/mails.service.js
//
// Les e-mails envoyés depuis le dashboard Kodafrik (création de compte, code
// d'accès, réponse à un message du site…), à la charte Kodafrik
// (mails.kodafrik.js). Auparavant envoyés par le PHP de kodafrik.com.
//
//   GET  /admin/sites/:site/mails   → { modeles, journal }   (50 derniers envois)
//   POST /admin/sites/:site/mails   { modele, a, prenom?, donnees, apercu? }
//        → { envoye: true }  ou, avec apercu: true, { sujet, html } sans rien envoyer
//
// Chaque envoi est journalisé (destinataire, modèle, auteur, succès) — jamais
// son contenu : un e-mail de bienvenue contient un mot de passe.

const sequelize = require('../../config/db');
const logger = require('../../utils/logger');
const { AppError, NotFoundError, TooManyRequestsError, ValidationError } = require('../../errors/AppError');
const { siteConnu, reglagesKodafrik } = require('./sites.config');
const { texte, ligne, estEmail } = require('./visiteur');
const MailsKodafrik = require('./mails.kodafrik');

/** Anti-abus : envois par administrateur et par heure. */
const ENVOIS_PAR_HEURE = 120;

const tous = (sql, replacements) => sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });

function siteAvecMails(id) {
  const site = siteConnu(id);
  if (!site || !site.mails) throw new NotFoundError('Site inconnu.');
  return site;
}

/** Les données d'un modèle, bornées (les messages, plus longs, gardent leurs lignes). */
function nettoyer(brutes) {
  const donnees = {};
  if (!brutes || typeof brutes !== 'object' || Array.isArray(brutes)) return donnees;
  for (const [cle, valeur] of Object.entries(brutes)) {
    if (!/^[a-zA-Z]{1,30}$/.test(cle)) continue;
    if (Array.isArray(valeur)) {
      donnees[cle] = valeur.map((v) => texte(v, 80)).filter(Boolean).slice(0, 10);
    } else if (cle === 'message' || cle === 'messageOrigine') {
      donnees[cle] = typeof valeur === 'object' || valeur === null || valeur === undefined
        ? ''
        : Array.from(String(valeur).replace(/<[^>]*>/g, '').trim()).slice(0, 8000).join('');
    } else {
      donnees[cle] = texte(valeur, 300) ?? '';
    }
  }
  return donnees;
}

class MailsSiteService {
  /** Les modèles connus et les 50 derniers envois. */
  static async journal(idSite) {
    const site = siteAvecMails(idSite);
    const modeles = Object.entries(MailsKodafrik.MODELES).map(([id, [libelle, champs]]) => ({ id, libelle, champs }));
    const lignes = await tous(
      `SELECT id, cree_le AS date, modele, destinataire, sujet, envoye, par
         FROM site_mail WHERE site = :site ORDER BY id DESC LIMIT 50`,
      { site: site.id },
    );
    const journal = lignes.map((l) => ({ ...l, id: Number(l.id), envoye: Boolean(l.envoye) }));
    return { modeles, journal };
  }

  /**
   * Rend (aperçu) ou envoie un e-mail. `auteur` : le nom de l'administrateur
   * connecté, pour le journal et la limite d'envois.
   */
  static async envoyer(idSite, corps = {}, auteur = null) {
    const site = siteAvecMails(idSite);
    const modele = String(corps.modele || '');
    if (!Object.prototype.hasOwnProperty.call(MailsKodafrik.MODELES, modele)) {
      throw new ValidationError('Modèle d’e-mail inconnu.');
    }
    const a = ligne(corps.a, 180);
    if (!a || !estEmail(a)) throw new ValidationError('Adresse du destinataire invalide.');

    const donnees = nettoyer(corps.donnees);
    donnees.prenom = texte(corps.prenom, 80);
    // Signé par l'administrateur, sauf mention contraire.
    donnees.auteur = texte(donnees.auteur, 80) || null;

    for (const champ of MailsKodafrik.MODELES[modele][1]) {
      const v = donnees[champ];
      if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) {
        throw new ValidationError(`Information manquante pour cet e-mail : ${champ}.`);
      }
    }
    if (donnees.codeAcces !== undefined && !/^\d{4}$/.test(String(donnees.codeAcces))) {
      throw new ValidationError('Le code d’accès doit faire quatre chiffres.');
    }

    const { sujet, html, texte: version } = MailsKodafrik.rendre(modele, donnees);
    if (corps.apercu) return { sujet, html };

    const par = ligne(auteur, 160);
    const [{ n } = { n: 0 }] = await tous(
      `SELECT COUNT(*) AS n FROM site_mail
        WHERE site = :site AND par IS NOT DISTINCT FROM :par AND cree_le > now() - interval '1 hour'`,
      { site: site.id, par },
    );
    if (Number(n) >= ENVOIS_PAR_HEURE) {
      throw new TooManyRequestsError('Trop d’e-mails envoyés cette heure-ci. Réessayez plus tard.');
    }

    const reglages = reglagesKodafrik();
    let erreur = null;
    try {
      await require('../resend.service').sendEmail({
        to: a,
        subject: sujet,
        html,
        text: version,
        from: reglages.expediteur,
        nomAffiche: site.nom,
        replyTo: reglages.contact,
      });
    } catch (err) {
      erreur = err.message || 'Envoi refusé.';
      logger.warn('[sites] e-mail non envoyé', { modele, message: erreur });
    }

    await sequelize.query(
      `INSERT INTO site_mail (site, modele, destinataire, sujet, envoye, erreur, par)
       VALUES (:site, :modele, :destinataire, :sujet, :envoye, :erreur, :par)`,
      {
        replacements: {
          site: site.id,
          modele,
          destinataire: a,
          sujet: Array.from(sujet).slice(0, 300).join(''),
          envoye: !erreur,
          erreur: erreur ? Array.from(erreur).slice(0, 300).join('') : null,
          par,
        },
      },
    ).catch((err) => logger.warn('[sites] journal des e-mails', { message: err.message }));

    if (erreur) throw new AppError("Le serveur n'a pas pu envoyer l'e-mail. Réessayez dans un instant.", 502);
    return { envoye: true };
  }
}

module.exports = MailsSiteService;
