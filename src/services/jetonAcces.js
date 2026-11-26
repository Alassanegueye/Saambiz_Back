const jwt = require('jsonwebtoken');
const { jwtConfig } = require('../config/security');

/**
 * Le jeton d'accès (JWT court). `ca` : le code d'accès de l'administrateur a
 * été vérifié pour cette session — sans lui, isAdmin refuse les routes /admin.
 */
function jetonAcces(utilisateur, { codeAcces = false } = {}) {
  return jwt.sign({
    id: utilisateur.id,
    nom: utilisateur.nom,
    prenom: utilisateur.prenom,
    email: utilisateur.email,
    role: utilisateur.role,
    ...(codeAcces ? { ca: true } : {}),
  }, jwtConfig.secret, { expiresIn: jwtConfig.expiresIn });
}

module.exports = { jetonAcces };
