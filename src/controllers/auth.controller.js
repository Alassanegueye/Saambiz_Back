const jwt = require('jsonwebtoken');
const AuthService = require('../services/auth.service');
const InscriptionService = require('../services/inscription.service');
const formatUser = require('../utils/formatUser');
const asyncHandler = require('../middlewares/asyncHandler');
const { BadRequestError, UnauthorizedError } = require('../errors/AppError');

/**
 * Contrôleurs d'authentification.
 *
 * Les corps de réponse en succès sont inchangés : l'application mobile déjà
 * installée les lit tels quels. Seul le chemin d'erreur a changé — plus de
 * try/catch par méthode, les échecs partent dans le gestionnaire global qui
 * les journalise avec l'identifiant de requête et l'URL.
 */

/**
 * Étape 1 — un code à six chiffres part à l'adresse indiquée.
 *
 * Aucun compte n'est créé ici : seule une ligne de vérification éphémère.
 */
exports.envoyerCodeInscription = asyncHandler(async (req, res) => {
  const { email, prenom } = req.body;
  const result = await InscriptionService.envoyerCode(email, { prenom });
  return res.status(200).json(result);
});

/**
 * Étape 2 — le code est validé, un jeton à usage unique est remis.
 *
 * Ce jeton est réclamé par l'inscription : il lie la création du compte à
 * cette vérification-là. Sans lui, entre la validation du code et l'envoi du
 * formulaire, un tiers connaissant l'adresse pourrait s'inscrire à sa place.
 */
exports.verifierCodeInscription = asyncHandler(async (req, res) => {
  const { email, code } = req.body;
  const result = await InscriptionService.verifierCode(email, code);
  return res.status(200).json(result);
});

exports.inscriptionUser = asyncHandler(async (req, res) => {
  const {
    nom, prenom, email, mot_de_passe, adresse, telephone, role,
    nomBoutique, description, localisation, categorie, slogan,
    telephoneBoutique, jetonEmail
  } = req.body;

  const photoProfil = req.files?.['photoProfil']?.[0] || null;
  const logo        = req.files?.['logo']?.[0]        || null;

  let boutique = null;
  if (role === 'Vendeur' && nomBoutique) {
    boutique = { nom: nomBoutique, description, localisation, categorie, slogan, telephone: telephoneBoutique, logo };
  }

  const result = await AuthService.register({ nom, prenom, email, mot_de_passe, adresse, telephone, photoProfil, role, boutique, jetonEmail });

  if (!result.success) {
    throw new BadRequestError(result.message);
  }

  return res.status(201).json({
    message: result.message,
    utilisateur: formatUser(result.utilisateur),
    abonnement: result.abonnement,
    boutique: result.boutique
  });
});

exports.login = asyncHandler(async (req, res) => {
  const { email, telephone, mot_de_passe } = req.body;
  const identifiant = email || telephone;

  if (!identifiant || !mot_de_passe) {
    throw new BadRequestError('Email/Téléphone et mot de passe sont obligatoires');
  }

  // Contexte d'appareil : sert à présenter « vos sessions ouvertes » et à
  // repérer une connexion inhabituelle.
  const contexte = { userAgent: req.get('user-agent'), ip: req.ip };
  const result = await AuthService.login({ identifiant, mot_de_passe }, contexte);

  if (!result.success) {
    throw new BadRequestError(result.error || result.message);
  }

  return res.status(200).json({
    token: result.token,
    refreshToken: result.refreshToken,
    utilisateur: formatUser(result.utilisateur),
    abonnement: result.abonnement,
    menus: result.menus || [],
  });
});

exports.logout = asyncHandler(async (req, res) => {
  const token = req.headers.authorization.split(' ')[1];
  const decoded = jwt.decode(token);
  const expiresAt = decoded?.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 3600000);
  const result = await AuthService.logout(token, expiresAt, req.body?.refreshToken);
  return res.status(200).json(result);
});

exports.refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    throw new BadRequestError('Le refresh token est requis');
  }

  const result = await AuthService.refreshToken(refreshToken, {
    userAgent: req.get('user-agent'),
    ip: req.ip,
  });
  if (!result.success) {
    throw new UnauthorizedError(result.message);
  }

  return res.status(200).json({ token: result.token, refreshToken: result.refreshToken });
});

// MED-03 : vérification email
exports.verifierEmail = asyncHandler(async (req, res) => {
  // Le lien cliqué depuis l'email passe par la query, l'application mobile
  // envoie un corps JSON : on accepte les deux.
  const { email, code } = { ...req.query, ...(req.body || {}) };
  if (!email || !code) {
    throw new BadRequestError('email et code sont requis');
  }

  const result = await AuthService.verifierEmail(email, code);
  if (!result.success) {
    throw new BadRequestError(result.message);
  }

  return res.status(200).json({ message: result.message });
});

// Renvoi du code de vérification (bouton « Renvoyer le code » du mobile)
exports.renvoyerCodeVerification = asyncHandler(async (req, res) => {
  const { email } = req.body || {};
  if (!email) {
    throw new BadRequestError('email est requis');
  }

  const result = await AuthService.renvoyerCodeVerification(email);
  return res.status(200).json({ message: result.message });
});
