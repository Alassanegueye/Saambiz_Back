const checkActiveUser = (req, res, next) => {
  // Vérifier que l'utilisateur a été ajouté par auth middleware
  if (!req.user) {
    return res.status(401).json({ message: 'Utilisateur non authentifié' });
  }

  // Vérifier que l'utilisateur est actif
  if (req.user.statut !== 'actif') {
    return res.status(403).json({
      message: 'Votre compte est désactivé. Veuillez contacter le support ou réactiver votre compte.',
      statut: req.user.statut
    });
  }

  // Passer au prochain middleware ou route
  next();
};

module.exports = checkActiveUser;
