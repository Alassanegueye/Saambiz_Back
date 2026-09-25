function isVendeur(req, res, next) {
  // 🔹 req.user doit être défini par le middleware JWT
  if (!req.user) {
    return res.status(401).json({ message: "Non authentifié" });
  }

  if (req.user.role !== 'Vendeur') {
    return res.status(403).json({ message: "Accès réservé aux vendeurs" });
  }

  next();
}

module.exports = isVendeur;