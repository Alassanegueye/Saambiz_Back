const jwt = require('jsonwebtoken');
const { jwtConfig } = require('../config/security');
const User = require('../models/utilisateur.model');
const TokenBlacklist = require('../models/tokenBlacklist.model');
const asyncHandler = require('./asyncHandler');
const { UnauthorizedError, NotFoundError } = require('../errors/AppError');

/**
 * Authentification obligatoire.
 *
 * L'ordre des vérifications compte : la signature est contrôlée **avant** la
 * consultation de la liste noire. Un jeton fabriqué de toutes pièces est ainsi
 * rejeté sans aucune requête en base — sinon il suffirait d'envoyer des jetons
 * bidons en rafale pour faire travailler PostgreSQL.
 *
 * Les erreurs partent dans le gestionnaire global : il traduit déjà
 * `TokenExpiredError` et `JsonWebTokenError` en 401, journalise avec
 * l'identifiant de requête, et renvoie le format unique { success, message }.
 */
const authMiddleware = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('Token manquant ou invalide');
  }

  const token = authHeader.split(' ')[1];

  // Signature et expiration d'abord (aucune I/O).
  const decoded = jwt.verify(token, jwtConfig.secret);

  // Puis la révocation explicite : déconnexion, changement de mot de passe,
  // suppression de compte.
  const revoque = await TokenBlacklist.findOne({ where: { token } });
  if (revoque) {
    throw new UnauthorizedError('Token révoqué, veuillez vous reconnecter');
  }

  const utilisateur = await User.findByPk(decoded.id);
  if (!utilisateur) {
    throw new NotFoundError('Utilisateur introuvable');
  }

  // Ajouter l'utilisateur à la requête pour les prochains middlewares / contrôleurs
  req.user = utilisateur;

  next();
});

module.exports = authMiddleware;
