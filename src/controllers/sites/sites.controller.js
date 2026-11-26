// controllers/sites/sites.controller.js
//
// Les sites vitrines suivis par cette API (kodafrik.com, saambiz.com) :
// fréquentation, formulaire de contact, e-mails du back-office Kodafrik, et
// pour SaamBiz les visites des boutiques et l'activité des vendeurs.

const asyncHandler = require('../../middlewares/asyncHandler');
const { ok, created } = require('../../utils/response');
const { NotFoundError } = require('../../errors/AppError');
const { siteConnu } = require('../../services/sites/sites.config');
const SuiviService = require('../../services/sites/suivi.service');
const StatistiquesSiteService = require('../../services/sites/statistiques.service');
const MessagesSiteService = require('../../services/sites/messages.service');
const MailsSiteService = require('../../services/sites/mails.service');
const VendeursSiteService = require('../../services/sites/vendeurs.service');

/** Le nom de l'administrateur connecté, pour les journaux. */
const auteur = (req) => {
  const u = req.user || {};
  return [u.prenom, u.nom].filter(Boolean).join(' ').trim() || u.email || null;
};

/** Refuse un site que l'API ne suit pas. */
function exigerSite(req) {
  const site = siteConnu(req.params.site);
  if (!site) throw new NotFoundError('Site inconnu.');
  return site;
}

// ── Public ────────────────────────────────────────────────────────────────

/**
 * POST /sites/:site/evenements — une page vue, un temps passé, un clic.
 * Toujours 204, même pour un événement écarté : le navigateur n'attend rien,
 * et un robot n'apprend pas ce qui est compté.
 */
exports.suivre = asyncHandler(async (req, res) => {
  await SuiviService.enregistrer(req.params.site, req.body, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
    entetes: req.headers,
  });
  res.status(204).end();
});

/** POST /sites/:site/messages — une demande du formulaire de contact. */
exports.recevoirMessage = asyncHandler(async (req, res) => {
  const data = await MessagesSiteService.recevoir(req.params.site, req.body || {}, { ip: req.ip });
  return created(res, data, 'Message envoyé.');
});

// ── Administration ────────────────────────────────────────────────────────

/** GET /admin/sites/:site/statistiques?periode=jour|7|30|90 */
exports.statistiques = asyncHandler(async (req, res) => {
  const site = exigerSite(req);
  const data = await StatistiquesSiteService.statistiques(site.id, req.query.periode);
  return ok(res, data, 'Fréquentation chargée.');
});

/** GET /admin/sites/:site/visites?periode=&page=&par=&source=&appareil=&pays=&ecrit=&q= */
exports.visites = asyncHandler(async (req, res) => {
  const site = exigerSite(req);
  const data = await StatistiquesSiteService.visites(site.id, req.query);
  return ok(res, data, 'Visites chargées.');
});

/** GET /admin/sites/:site/messages?statut=&q=&page= */
exports.messages = asyncHandler(async (req, res) => {
  const data = await MessagesSiteService.lister(req.params.site, req.query);
  return ok(res, data, 'Messages chargés.');
});

/** PATCH /admin/sites/:site/messages/:id { statut } */
exports.changerStatutMessage = asyncHandler(async (req, res) => {
  const data = await MessagesSiteService.changerStatut(req.params.site, req.params.id, req.body?.statut, auteur(req));
  return ok(res, data, 'Message mis à jour.');
});

/** GET /admin/sites/:site/mails — modèles et 50 derniers envois. */
exports.mails = asyncHandler(async (req, res) => {
  const data = await MailsSiteService.journal(req.params.site);
  return ok(res, data, 'E-mails chargés.');
});

/** POST /admin/sites/:site/mails { modele, a, prenom?, donnees, apercu? } */
exports.envoyerMail = asyncHandler(async (req, res) => {
  const data = await MailsSiteService.envoyer(req.params.site, req.body || {}, auteur(req));
  return ok(res, data, data.envoye ? 'E-mail envoyé.' : 'Aperçu prêt.');
});

/** GET /admin/sites/saambiz/boutiques?periode= */
exports.boutiques = asyncHandler(async (req, res) => {
  const data = await VendeursSiteService.boutiques(req.query.periode);
  return ok(res, data, 'Visites des boutiques chargées.');
});

/** GET /admin/sites/saambiz/vendeurs?periode=&filtre=&q=&page=&par= */
exports.vendeurs = asyncHandler(async (req, res) => {
  const data = await VendeursSiteService.vendeurs(req.query);
  return ok(res, data, 'Vendeurs chargés.');
});

/** GET /admin/sites/saambiz/vendeurs/:id/activites?periode= */
exports.activitesVendeur = asyncHandler(async (req, res) => {
  const data = await VendeursSiteService.activites(req.params.id, req.query.periode);
  return ok(res, data, 'Activité chargée.');
});
