const jwt = require('jsonwebtoken');
const { jwtConfig } = require('../config/security');
const User = require('../models/utilisateur.model');
const TokenBlacklist = require('../models/tokenBlacklist.model');

/**
 * Authentification facultative.
 *
 * Renseigne `req.user` si un jeton valide accompagne la requête, et laisse
 * simplement passer sinon. Sert aux routes ouvertes aux invités dont la
 * réponse s'enrichit quand on sait à qui on parle — l'accueil personnalisé
 * en premier lieu : un visiteur non connecté doit voir des boutiques, un
 * client connecté doit voir LES SIENNES en plus.
 *
 * Aucun cas d'erreur ne bloque : un jeton expiré ou révoqué ramène
 * simplement au comportement invité.
 */
const authOptionnel = async (req, _res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return next();

  try {
    const token = authHeader.split(' ')[1];

    const blacklisted = await TokenBlacklist.findOne({ where: { token } });
    if (blacklisted) return next();

    const decoded = jwt.verify(token, jwtConfig.secret);
    const utilisateur = await User.findByPk(decoded.id);
    if (utilisateur) req.user = utilisateur;
  } catch {
    // Jeton absent, expiré, invalide : on continue en invité.
  }

  return next();
};

module.exports = authOptionnel;
