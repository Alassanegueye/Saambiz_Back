// Script de seed à lancer UNE SEULE FOIS au premier déploiement
// Commande : npm run seed
// HIGH-03 : seed externalisé, ne tourne plus au démarrage du serveur
const sequelize = require('../config/db');
const logger = require('../utils/logger');

require('../models/index');

(async () => {
  try {
    await sequelize.authenticate();
    logger.info('[runSeed] Connexion DB OK');

    // 1) Menus d'abord (l'admin a besoin qu'ils existent pour recevoir les permissions)
    const seedMenus = require('./seedMenus');
    const n = await seedMenus();
    logger.info(`[runSeed] ${n} menus initialisés`);

    // 2) Admin + permissions complètes
    const seedAdmin = require('./seedAdmin');
    await seedAdmin();

    // 3) Catégories génériques de la marketplace
    const seedCategories = require('./seedCategories');
    const nbCat = await seedCategories();
    logger.info(`[runSeed] ${nbCat} catégories initialisées`);

    logger.info('[runSeed] Seed terminé avec succès');
    process.exit(0);
  } catch (err) {
    logger.error('[runSeed] Erreur', { message: err.message });
    process.exit(1);
  }
})();
