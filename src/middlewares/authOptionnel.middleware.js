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
 *
 * L'ORDRE DES VÉRIFICATIONS COMPTE, et il est le même que dans
 * `auth.middleware` : la signature d'abord, la liste noire ensuite.
 *
 * Ce middleware faisait l'inverse. Il consultait la table des jetons révoqués
 * avant de vérifier quoi que ce soit, donc un jeton fabriqué de toutes pièces
 * déclenchait une requête PostgreSQL avant d'être rejeté. Les routes qui
 * l'utilisent — l'accueil personnalisé, le catalogue — sont ouvertes aux
 * visiteurs sans compte : il suffisait d'y envoyer des jetons bidons en
 * rafale pour faire travailler la base. La signature, elle, ne coûte aucune
 * entrée-sortie.
 */
const authOptionnel = async (req, _res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return next();

  try {
    const token = authHeader.split(' ')[1];

    // Signature et expiration d'abord (aucune I/O). `optionsVerification`
    // épingle l'algorithme — voir config/security.js.
    const decoded = jwt.verify(token, jwtConfig.secret, jwtConfig.optionsVerification);

    // Puis la révocation explicite.
    const blacklisted = await TokenBlacklist.findOne({ where: { token } });
    if (blacklisted) return next();

    const utilisateur = await User.findByPk(decoded.id);
    if (utilisateur) req.user = utilisateur;
  } catch {
    // Jeton absent, expiré, invalide : on continue en invité.
  }

  return next();
};

module.exports = authOptionnel;
