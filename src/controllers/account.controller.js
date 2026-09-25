const jwt = require('jsonwebtoken');
const AccountService = require('../services/account.service');
const asyncHandler = require('../middlewares/asyncHandler');
const { BadRequestError, ConflictError } = require('../errors/AppError');

exports.me = asyncHandler(async (req, res) => {
  const utilisateur = await AccountService.getMe(req.user.id);
  return res.status(200).json({ utilisateur });
});

exports.updateProfile = asyncHandler(async (req, res) => {
  const result = await AccountService.updateProfile({
    userId: req.user.id,
    data: req.body,
    photoFile: req.file
  });
  // 409 : l'email ou le téléphone visé appartient déjà à un autre compte.
  if (!result.success) throw new ConflictError(result.message);
  return res.status(200).json(result);
});

exports.changePassword = asyncHandler(async (req, res) => {
  const { ancienMotDePasse, nouveauMotDePasse } = req.body;
  const result = await AccountService.changePassword(req.user.id, ancienMotDePasse, nouveauMotDePasse);
  if (!result.success) throw new BadRequestError(result.message);
  return res.status(200).json(result);
});

exports.forgotPassword = asyncHandler(async (req, res) => {
  const result = await AccountService.forgotPassword(req.body.email);
  return res.status(200).json(result);
});

exports.resetPassword = asyncHandler(async (req, res) => {
  const { email, otp, nouveauMotDePasse } = req.body;
  const result = await AccountService.resetPassword(email, otp, nouveauMotDePasse);
  if (!result.success) throw new BadRequestError(result.message);
  return res.status(200).json(result);
});

// ----
// Suppression de compte en libre-service (Google Play — politique "Account Deletion")
// L'utilisateur connecté (Acheteur ou Vendeur) supprime lui-même son compte.
exports.deleteAccount = asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader ? authHeader.split(' ')[1] : null;

  // Récupère l'expiration réelle du token pour la blacklist (même logique que auth.logout)
  let expiresAt = new Date(Date.now() + 3600000);
  if (token) {
    const decoded = jwt.decode(token);
    if (decoded?.exp) expiresAt = new Date(decoded.exp * 1000);
  }

  const result = await AccountService.deleteAccount(req.user.id, {
    motif: req.body?.motif,
    token,
    expiresAt
  });

  // 409 : une commande en cours empêche la suppression immédiate.
  if (!result.success) throw new ConflictError(result.message);
  return res.status(200).json(result);
});
