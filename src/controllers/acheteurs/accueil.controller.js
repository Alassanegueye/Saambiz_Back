const AccueilService = require('../../services/acheteurs/accueil.service');
const asyncHandler = require('../../middlewares/asyncHandler');

/**
 * Accueil personnalisé, ouvert aux invités.
 *
 * GET /saambiz/acheteurs/accueil-personnalise
 *   ?interets=Mode,Beauté   centres d'intérêt d'un invité (ignorés si connecté)
 *   &latitude=..&longitude=..  position, si la géolocalisation a été acceptée
 */
exports.accueilPersonnalise = asyncHandler(async (req, res) => {
  const interetsInvite = String(req.query.interets || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);

  const resultat = await AccueilService.construire({
    utilisateur: req.user || null,
    interetsInvite,
    latitude: req.query.latitude,
    longitude: req.query.longitude,
  });

  return res.status(200).json(resultat);
});

/**
 * Tout le contenu d'une section de l'accueil (bouton « Voir tout »).
 *
 * GET /saambiz/acheteurs/accueil-section/:cle
 *   mêmes paramètres que l'accueil (+ limit, 60 par défaut, 100 au plus)
 */
exports.accueilSection = asyncHandler(async (req, res) => {
  const interetsInvite = String(req.query.interets || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);

  const resultat = await AccueilService.section(req.params.cle, {
    utilisateur: req.user || null,
    interetsInvite,
    latitude: req.query.latitude,
    longitude: req.query.longitude,
    limit: req.query.limit,
  });
  if (!resultat) {
    return res.status(404).json({ success: false, message: 'Section inconnue.' });
  }
  return res.status(200).json({ cle: req.params.cle, ...resultat });
});

/** GET /saambiz/acheteurs/preferences — client connecté uniquement. */
exports.getPreferences = asyncHandler(async (req, res) => {
  const prefs = await AccueilService.getPreferences(req.user.id);
  return res.status(200).json(prefs);
});

/**
 * PUT /saambiz/acheteurs/preferences
 * body : { interets?: string[], latitude?, longitude?, ville? }
 *
 * Sert aussi bien à enregistrer les centres d'intérêt choisis à
 * l'inscription qu'à remonter la position après acceptation de la
 * géolocalisation — l'application appelle la même route dans les deux cas.
 */
exports.majPreferences = asyncHandler(async (req, res) => {
  const prefs = await AccueilService.majPreferences(req.user.id, req.body || {});
  return res.status(200).json(prefs);
});
