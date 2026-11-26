// services/sites/messages.service.js
//
// Les demandes du formulaire de contact d'un site vitrine (kodafrik.com).
//
//   POST  /sites/:site/messages              (public)  → 201 { envoye: true }
//   GET   /admin/sites/:site/messages?statut=&q=&page=
//   PATCH /admin/sites/:site/messages/:id    { statut }
//
// La demande est enregistrée AVANT l'envoi du mail : si l'envoi échoue, elle
// n'est pas perdue — elle attend dans le dashboard, et le visiteur n'a pas à
// recommencer. Le mail part vers l'adresse de contact, le client en
// « répondre à » : répondre au mail lui écrit directement.

const sequelize = require('../../config/db');
const logger = require('../../utils/logger');
const { BadRequestError, NotFoundError, ValidationError } = require('../../errors/AppError');
const { siteConnu, reglagesKodafrik } = require('./sites.config');
const { texte, ligne, ipAnonyme, estEmail } = require('./visiteur');
const MailsKodafrik = require('./mails.kodafrik');

const STATUTS = ['nouveau', 'lu', 'traite', 'archive'];
const PAR_PAGE = 20;
const NUMERO_VISITE = /^[A-Za-z0-9_-]{8,40}$/;

const tous = (sql, replacements) => sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });
const motif = (q) => `%${String(q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Le site, s'il reçoit des messages ; sinon 404. */
function siteAvecMessages(id) {
  const site = siteConnu(id);
  if (!site || !site.messages) throw new NotFoundError('Site inconnu.');
  return site;
}

class MessagesSiteService {
  /**
   * Une demande du formulaire. Renvoie { envoye: true } — y compris pour un
   * robot (champ piège rempli), à qui l'on ne dit pas qu'il est écarté.
   */
  static async recevoir(idSite, corps = {}, { ip } = {}) {
    const site = siteAvecMessages(idSite);
    const d = corps && typeof corps === 'object' ? corps : {};

    if (texte(d.piege, 200) || d.botcheck === true || d.botcheck === '1' || d.botcheck === 'true') {
      return { envoye: true };
    }

    const nom = ligne(d.nom, 120);
    const entreprise = ligne(d.entreprise, 150);
    const email = ligne(d.email, 180);
    const telephone = ligne(d.telephone, 40);
    const type = ligne(d.type, 120);
    const budget = ligne(d.budget, 120);
    const message = texte(d.message, 5000);

    // 422 et non 400 : le formulaire du site lit 422 comme un refus réfléchi
    // et n'essaie pas sa destination de secours (src/components/Contact.jsx).
    if (!nom || Array.from(nom).length < 2) throw new ValidationError('Indiquez votre nom.');
    if (!email || !estEmail(email)) throw new ValidationError('Adresse e-mail invalide.');
    if (!message || Array.from(message).length < 15) throw new ValidationError('Décrivez votre projet en quelques mots.');

    const visite = texte(d.session, 40);
    const [enregistre] = await tous(
      `INSERT INTO site_message (site, nom, entreprise, email, telephone, type, budget, message, visite, page, ip_anonyme)
       VALUES (:site, :nom, :entreprise, :email, :telephone, :type, :budget, :message, :visite, :page, :ipAnonyme)
       RETURNING id`,
      {
        site: site.id,
        nom,
        entreprise,
        email,
        telephone,
        type,
        budget,
        message,
        visite: visite && NUMERO_VISITE.test(visite) ? visite : null,
        page: ligne(d.page, 300),
        ipAnonyme: ipAnonyme(ip),
      },
    );

    // Le mail à l'équipe. Son échec ne remonte pas au visiteur : la demande
    // est enregistrée, l'équipe la retrouve dans le dashboard.
    try {
      const { sujet, html, texte: version } = MailsKodafrik.rendre('contact_recu', {
        nom, entreprise, email, telephone, type, budget, message,
      });
      const reglages = reglagesKodafrik();
      await require('../resend.service').sendEmail({
        to: reglages.contact,
        subject: sujet,
        html,
        text: version,
        from: reglages.expediteur,
        nomAffiche: `Site ${site.nom}`,
        replyTo: `${nom.replace(/["<>]/g, '')} <${email}>`,
      });
      if (enregistre?.id) {
        await sequelize.query('UPDATE site_message SET mail_envoye = true WHERE id = :id', { replacements: { id: enregistre.id } });
      }
    } catch (err) {
      logger.warn('[sites] mail de contact non envoyé', { message: err.message });
    }

    return { envoye: true };
  }

  /** Les messages, 20 par page, du plus récent au plus ancien. */
  static async lister(idSite, { statut = '', q = '', page = 1 } = {}) {
    const site = siteAvecMessages(idSite);
    const conditions = ['site = :site'];
    const valeurs = { site: site.id };
    if (STATUTS.includes(statut)) {
      conditions.push('statut = :statut');
      valeurs.statut = statut;
    } else if (statut !== 'tous') {
      // Par défaut : tout sauf les archivés.
      conditions.push("statut <> 'archive'");
    }
    const recherche = texte(q, 100);
    if (recherche) {
      conditions.push('(nom ILIKE :q OR email ILIKE :q OR entreprise ILIKE :q OR message ILIKE :q OR telephone ILIKE :q)');
      valeurs.q = motif(recherche);
    }
    const ou = `WHERE ${conditions.join(' AND ')}`;
    const numero = Math.max(1, parseInt(page, 10) || 1);

    const [[{ n: total } = { n: 0 }], lignes, compteursBruts] = await Promise.all([
      tous(`SELECT COUNT(*) AS n FROM site_message ${ou}`, valeurs),
      tous(
        `SELECT id, cree_le AS date, nom, entreprise, email, telephone, type, budget, message, statut,
                mail_envoye, visite, page, ip_anonyme, traite_par, traite_le
           FROM site_message ${ou}
          ORDER BY cree_le DESC LIMIT ${PAR_PAGE} OFFSET :decalage`,
        { ...valeurs, decalage: (numero - 1) * PAR_PAGE },
      ),
      tous('SELECT statut, COUNT(*) AS n FROM site_message WHERE site = :site GROUP BY statut', { site: site.id }),
    ]);

    // Le parcours du visiteur avant d'écrire : les pages vues dans sa visite,
    // et d'où il venait.
    const visites = [...new Set(lignes.map((m) => m.visite).filter(Boolean))];
    const pages = visites.length
      ? await tous(
        `SELECT visite, chemin, titre, cree_le AS date, source, appareil, navigateur, os, pays, langue, ecran
           FROM site_evenement
          WHERE site = :site AND type = 'page' AND visite IN (:visites)
          ORDER BY cree_le, id`,
        { site: site.id, visites },
      )
      : [];
    const parVisite = new Map();
    for (const p of pages) {
      if (!parVisite.has(p.visite)) parVisite.set(p.visite, []);
      parVisite.get(p.visite).push(p);
    }

    const messages = lignes.map(({ visite, ...m }) => {
      const vues = parVisite.get(visite) || [];
      const premiere = vues[0];
      return {
        ...m,
        id: Number(m.id),
        mail_envoye: Boolean(m.mail_envoye),
        parcours: vues.slice(0, 30).map((p) => ({ chemin: p.chemin, titre: p.titre, date: p.date })),
        visite: premiere
          ? {
            source: premiere.source, appareil: premiere.appareil, navigateur: premiere.navigateur,
            os: premiere.os, pays: premiere.pays, langue: premiere.langue, ecran: premiere.ecran,
          }
          : null,
      };
    });

    const compteurs = {};
    for (const l of compteursBruts) compteurs[l.statut] = Number(l.n) || 0;

    return { messages, total: Number(total) || 0, page: numero, parPage: PAR_PAGE, compteurs };
  }

  /** Lu, traité, archivé — ou de nouveau « nouveau ». */
  static async changerStatut(idSite, id, statut, auteur) {
    const site = siteAvecMessages(idSite);
    const numero = parseInt(id, 10);
    if (!(numero > 0) || !STATUTS.includes(statut)) throw new BadRequestError('Statut ou message invalide.');
    const lignes = await tous(
      `UPDATE site_message SET statut = :statut, traite_par = :auteur, traite_le = now()
        WHERE id = :id AND site = :site RETURNING id`,
      { statut, auteur: ligne(auteur, 160), id: numero, site: site.id },
    );
    if (!lignes.length) throw new NotFoundError('Message introuvable.');
    return { id: numero, statut };
  }
}

MessagesSiteService.STATUTS = STATUTS;
module.exports = MessagesSiteService;
