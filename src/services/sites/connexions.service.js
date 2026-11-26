// services/sites/connexions.service.js
//
// Chaque connexion réussie, une ligne : quand, depuis l'application ou un
// navigateur, sur quel appareil. `utilisateur.derniere_connexion` ne garde que
// la dernière ; l'activité d'un vendeur (page « Site vitrine » de
// l'administration SaamBiz) a besoin des précédentes.
//
// Best-effort : une connexion ne doit jamais échouer parce que son journal
// n'a pas pu s'écrire.

const sequelize = require('../../config/db');
const logger = require('../../utils/logger');
const { lireAgent, estApplication, ipAnonyme } = require('./visiteur');

class ConnexionsService {
  static async enregistrer({ utilisateurId, userAgent, ip, maintenant = new Date() } = {}) {
    try {
      if (!utilisateurId) return false;
      const application = estApplication(userAgent);
      const { appareil, navigateur, os } = lireAgent(userAgent);
      await sequelize.query(
        `INSERT INTO connexion_utilisateur (utilisateur_id, cree_le, application, appareil, navigateur, os, ip_anonyme)
         VALUES (:utilisateurId, :creeLe, :application, :appareil, :navigateur, :os, :ipAnonyme)`,
        {
          replacements: {
            utilisateurId,
            creeLe: maintenant,
            application,
            appareil: application ? 'Mobile' : appareil,
            navigateur: application ? null : navigateur,
            os: application ? null : os,
            ipAnonyme: ipAnonyme(ip),
          },
        },
      );
      return true;
    } catch (err) {
      logger.warn('[connexions] connexion non journalisée', { message: err.message });
      return false;
    }
  }
}

module.exports = ConnexionsService;
