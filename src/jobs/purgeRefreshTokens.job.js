const RefreshTokenService = require('../services/refreshToken.service');
const logger = require('../utils/logger');

/**
 * Purge les jetons de rafraîchissement expirés, et ceux révoqués depuis plus
 * de 30 jours. Sans ce passage, la table grossit indéfiniment et chaque
 * rafraîchissement paie le coût d'un index de plus en plus large.
 */
async function purgerRefreshTokens() {
  const supprimes = await RefreshTokenService.purger();
  if (supprimes > 0) {
    logger.info('job.purgeRefreshTokens', { supprimes });
  }
  return supprimes;
}

module.exports = purgerRefreshTokens;
