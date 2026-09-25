const AuthService = require('../services/auth.service');
const asyncHandler = require('../middlewares/asyncHandler');
const { BadRequestError } = require('../errors/AppError');

exports.changerMotDePasse = asyncHandler(async (req, res) => {
  const { ancienMotDePasse, nouveauMotDePasse, confirmation } = req.body;
  if (!ancienMotDePasse || !nouveauMotDePasse || !confirmation) {
    throw new BadRequestError('Tous les champs sont requis.');
  }

  // Le service lève une erreur portant son propre `status` (401 ancien mot de
  // passe faux, 400 politique non respectée) : le gestionnaire global la relaie.
  const result = await AuthService.changerMotDePasse(
    req.user.id,
    ancienMotDePasse,
    nouveauMotDePasse,
    confirmation
  );
  res.json(result);
});
