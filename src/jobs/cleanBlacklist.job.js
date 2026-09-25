const { TokenBlacklist } = require('../models');
const { Op } = require('sequelize');

async function cleanExpiredTokens() {
  try {
    const deleted = await TokenBlacklist.destroy({
      where: { expiresAt: { [Op.lt]: new Date() } }
    });
    console.log(`🧹 Tokens expirés supprimés de la blacklist : ${deleted}`);
  } catch (err) {
    console.error('Erreur nettoyage blacklist tokens:', err);
    throw err;
  }
}

module.exports = cleanExpiredTokens;
