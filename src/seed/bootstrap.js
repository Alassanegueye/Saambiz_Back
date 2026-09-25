// Bootstrap Docker : prépare la base AVANT le démarrage du serveur.
//   1) attend/authentifie la connexion PostgreSQL
//   2) crée les tables manquantes (sequelize.sync, sans altérer l'existant)
//   3) applique les migrations SQL (colonnes ajoutées aux tables existantes,
//      que sync ne sait pas créer)
//   4) lance le seed idempotent (menus + admin + catégories)
//
// Objectif : rendre le conteneur "clé en main" — l'utilisateur n'a AUCUNE base
// ni aucun seed à créer à la main. Ce script est idempotent : il peut tourner
// à chaque démarrage sans dupliquer de données (findOrCreate partout).
//
// Utilisé par docker-compose : `node src/seed/bootstrap.js && node src/server.js`
const sequelize = require('../config/db');
const logger = require('../utils/logger');

// Charge tous les modèles + associations (index requiert chaque modèle)
require('../models/index');

async function waitForDb(retries = 20, delayMs = 3000) {
  for (let i = 1; i <= retries; i++) {
    try {
      await sequelize.authenticate();
      logger.info('[bootstrap] Connexion DB OK');
      return;
    } catch (err) {
      logger.warn(`[bootstrap] DB indisponible (tentative ${i}/${retries}) — nouvel essai dans ${delayMs / 1000}s`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('[bootstrap] Impossible de joindre PostgreSQL après plusieurs tentatives');
}

(async () => {
  try {
    await waitForDb();

    // Création des tables manquantes (jamais { alter/force } — voir server.js)
    await sequelize.sync({ force: false });
    logger.info('[bootstrap] Schéma synchronisé (tables manquantes créées)');

    // Migrations SQL : sync ne touche pas aux tables déjà présentes, donc
    // c'est ici que les colonnes ajoutées après coup arrivent réellement.
    const migrate = require('./migrate');
    const nbMigrations = await migrate();
    if (nbMigrations > 0) {
      logger.info(`[bootstrap] ${nbMigrations} migration(s) appliquée(s)`);
    }

    // Seed idempotent : menus d'abord (l'admin en a besoin), puis admin, puis catégories
    const seedMenus = require('./seedMenus');
    const nbMenus = await seedMenus();
    logger.info(`[bootstrap] ${nbMenus} menus initialisés`);

    const seedAdmin = require('./seedAdmin');
    await seedAdmin();

    const seedCategories = require('./seedCategories');
    const nbCat = await seedCategories();
    logger.info(`[bootstrap] ${nbCat} catégories initialisées`);

    logger.info('[bootstrap] Base prête — démarrage du serveur');
    await sequelize.close();
    process.exit(0);
  } catch (err) {
    logger.error('[bootstrap] Échec de la préparation de la base', { message: err.message });
    process.exit(1);
  }
})();
