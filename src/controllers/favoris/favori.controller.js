const FavoriService = require('../../services/favoris/favori.service');
const AccueilService = require('../../services/acheteurs/accueil.service');
const { Boutique } = require('../../models');
const asyncHandler = require('../../middlewares/asyncHandler');
const { ConflictError, NotFoundError } = require('../../errors/AppError');

exports.ajouterFavori = asyncHandler(async (req, res) => {
  const result = await FavoriService.ajouterFavori(req.user.id, req.body.boutiqueId);
  // S'abonner est un choix explicite : la catégorie de la boutique pèse
  // lourd dans les propositions suivantes.
  Boutique.findByPk(req.body.boutiqueId, { attributes: ['categorie'] })
    .then((b) => AccueilService.enregistrerAffinite(req.user.id, b?.categorie, 'abonnement'))
    .catch(() => {});
  if (!result.success) throw new ConflictError(result.message);
  return res.status(201).json(result);
});

exports.supprimerFavori = asyncHandler(async (req, res) => {
  const result = await FavoriService.supprimerFavori(req.user.id, req.params.boutiqueId);
  if (!result.success) throw new NotFoundError(result.message);
  return res.status(200).json(result);
});

exports.mesFavoris = asyncHandler(async (req, res) => {
  const favoris = await FavoriService.mesFavoris(req.user.id);
  return res.status(200).json({ favoris });
});

// 🔔 Active/désactive la cloche de notifications d'une boutique
exports.toggleCloche = asyncHandler(async (req, res) => {
  // active fourni ({ active: true/false }) ; sinon on bascule selon l'état courant
  let active = req.body?.active;
  if (typeof active === 'undefined') {
    const statut = await FavoriService.statutSuivi(req.user.id, req.params.boutiqueId);
    active = !statut.clocheActive;
  } else {
    active = active === true || active === 'true';
  }
  const result = await FavoriService.toggleCloche(req.user.id, req.params.boutiqueId, active);
  return res.status(200).json(result);
});

// État de suivi d'une boutique pour l'acheteur connecté (suivi + cloche)
exports.statutSuivi = asyncHandler(async (req, res) => {
  const statut = await FavoriService.statutSuivi(req.user.id, req.params.boutiqueId);
  return res.status(200).json(statut);
});
