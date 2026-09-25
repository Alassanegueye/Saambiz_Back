const cron = require('node-cron');
const expireAbonnements = require('./abonnement.job');
const cleanExpiredTokens = require('./cleanBlacklist.job');
const expirerPromotions = require('./promotion.job');
const purgerRefreshTokens = require('./purgeRefreshTokens.job');
const logger = require('../utils/logger');

function startJobs() {
  // MED-01 : logger structuré, plus de console.log

  // Vérification abonnements — tous les jours à 00:00
  cron.schedule('0 0 * * *', async () => {
    try {
      logger.info('job.abonnement démarré');
      await expireAbonnements();
    } catch (err) {
      logger.error('job.abonnement erreur', { message: err.message });
    }
  });

  // Expiration des promotions — tous les jours à 00:05
  cron.schedule('5 0 * * *', async () => {
    try {
      await expirerPromotions();
    } catch (err) {
      logger.error('job.promotion erreur', { message: err.message });
    }
  });

  // HIGH-06 : nettoyage blacklist toutes les 15 minutes (au lieu d'1h)
  // Réduit la taille de la table entre deux passes et améliore les perfs du check auth
  cron.schedule('*/15 * * * *', async () => {
    try {
      await cleanExpiredTokens();
    } catch (err) {
      logger.error('job.cleanBlacklist erreur', { message: err.message });
    }
  });

  // Purge des sessions expirées — toutes les heures. Moins urgent que la
  // liste noire : ces lignes ne sont lues qu'au rafraîchissement.
  cron.schedule('20 * * * *', async () => {
    try {
      await purgerRefreshTokens();
    } catch (err) {
      logger.error('job.purgeRefreshTokens erreur', { message: err.message });
    }
  });

  logger.info('Cron jobs démarrés (abonnements: 00h00 | promotions: 00h05 | blacklist: 15 min | sessions: horaire)');
}

module.exports = startJobs;
