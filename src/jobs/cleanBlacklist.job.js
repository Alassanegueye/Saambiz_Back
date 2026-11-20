const { TokenBlacklist } = require('../models');
const { Op } = require('sequelize');
const logger = require('../utils/logger');

async function cleanExpiredTokens() {
  try {
    const deleted = await TokenBlacklist.destroy({
      where: { expiresAt: { [Op.lt]: new Date() } }
    });
    logger.info(`Tokens expirés supprimés de la blacklist : ${deleted}`);
  } catch (err) {
    logger.error('Erreur nettoyage blacklist tokens', { message: err.message, stack: err.stack });
    throw err;
  }
}

module.exports = cleanExpiredTokens;
