const Abonnement = require('../models/abonnement.model');
const { Op } = require('sequelize');
const logger = require('../utils/logger');

async function checkAbonnement(req, res, next) {
  try {
    // 🔐 Vérifier authentification
    if (!req.user) {
      return res.status(401).json({ message: "Non authentifié" });
    }

    // 👤 Vérifier rôle vendeur
    if (req.user.role !== 'Vendeur') {
      return res.status(403).json({ message: "Accès réservé aux vendeurs" });
    }

    const maintenant = new Date();
    const utilisateurId = req.user.id;

    // 🔍 Chercher abonnement actif
    const abonnement = await Abonnement.findOne({
      where: {
        utilisateurId: utilisateurId,
        statut: 'actif',
        dateFin: {
          [Op.gte]: maintenant
        }
      },
      order: [['dateFin', 'DESC']]
    });

    // ❌ Aucun abonnement valide
    if (!abonnement) {
      return res.status(403).json({
        message: "Votre abonnement est expiré. Veuillez payer pour continuer."
      });
    }

    // ✅ OK → passer à la suite
    req.abonnement = abonnement; // (optionnel, utile)
    next();

  } catch (error) {
    logger.error('finAbonnement.middleware', { message: error.message });
    return res.status(500).json({ message: 'Erreur serveur interne.' });
  }
}

module.exports = checkAbonnement;