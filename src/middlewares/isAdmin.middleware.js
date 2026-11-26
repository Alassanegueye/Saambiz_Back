const { obligatoire } = require('../config/codeAcces');

/**
 * Administrateur, ET code d'accès vérifié pour cette session.
 *
 * Le code à quatre chiffres (portail KODAFRIK) est exigé ici, par le serveur :
 * sans lui, le mot de passe seul n'ouvre aucune route /admin — une session
 * reprise hors du portail, ou un jeton récupéré, se heurte à 403.
 */
function isAdmin(req, res, next) {
  // Vérifier que l'utilisateur est authentifié
  if (!req.user) {
    return res.status(401).json({ message: "Non authentifié" });
  }

  // Vérifier le rôle
  if (req.user.role !== 'Admin') {
    return res.status(403).json({ message: "Accès réservé aux administrateurs" });
  }

  if (obligatoire() && req.codeAccesVerifie !== true) {
    return res.status(403).json({
      success: false,
      code: 'CODE_ACCES_REQUIS',
      message: "Saisissez votre code d'accès sur le portail KODAFRIK pour ouvrir l'administration.",
    });
  }

  next();
}

module.exports = isAdmin;
