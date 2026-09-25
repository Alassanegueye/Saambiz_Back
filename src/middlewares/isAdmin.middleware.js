function isAdmin(req, res, next) {
  // Vérifier que l'utilisateur est authentifié
  if (!req.user) {
    return res.status(401).json({ message: "Non authentifié" });
  }

  // Vérifier le rôle
  if (req.user.role !== 'Admin') {
    return res.status(403).json({ message: "Accès réservé aux administrateurs" });
  }

  next();
}

module.exports = isAdmin;