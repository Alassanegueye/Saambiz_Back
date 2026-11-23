require('dotenv').config();
const { sequelize, Menu } = require('../models');
const logger = require('../utils/logger');

const DEFAULT_MENUS = [
  { name: "Vue d'ensemble",  code: 'DASHBOARD',    path: '/',              icon: 'dashboard', ordre: 1 },
  { name: 'Vendeurs',        code: 'VENDEURS',      path: '/vendeurs',      icon: 'store',     ordre: 2 },
  { name: 'Acheteurs',       code: 'ACHETEURS',     path: '/acheteurs',     icon: 'people',    ordre: 3 },
  { name: 'Produits',        code: 'PRODUITS',      path: '/produits',      icon: 'inventory', ordre: 4 },
  { name: 'Catégories',      code: 'CATEGORIES',    path: '/categories',    icon: 'category',  ordre: 5 },
  { name: 'Commandes',       code: 'COMMANDES',     path: '/commandes',     icon: 'receipt',   ordre: 6 },
  { name: 'Paiements',       code: 'PAIEMENTS',     path: '/paiements',     icon: 'payment',   ordre: 7 },
  { name: 'Abonnements',     code: 'ABONNEMENTS',   path: '/abonnements',   icon: 'card',      ordre: 8 },
  { name: 'Modération',      code: 'MODERATION',    path: '/moderation',    icon: 'check',     ordre: 9 },
  { name: 'Validation vendeurs', code: 'VALIDATION_VENDEURS', path: '/validation-vendeurs', icon: 'verified', ordre: 10 },
  // Trois rubriques qui existaient côté API sans menu : sans ligne ici,
  // aucun droit n'était attribuable, et seul un SuperAdmin — qui
  // court-circuite la table des permissions — pouvait les atteindre. Les
  // retours et l'activité avaient même une page, accessible en tapant
  // l'adresse et par aucun lien.
  //
  // `ordre` ne décide pas de la place dans la navigation du back-office
  // (voir `navigationAdmin.js`, qui groupe les rubriques lui-même) : il sert
  // à l'écran d'attribution des droits.
  { name: 'Signalements',    code: 'SIGNALEMENTS',  path: '/signalements',  icon: 'check',     ordre: 11 },
  { name: 'Administrateurs', code: 'ADMINS',        path: '/admins',        icon: 'admin',     ordre: 12 },
  { name: 'Activité',        code: 'ACTIVITE',      path: '/audit-logs',    icon: 'admin',     ordre: 13 },
  { name: 'Retours',         code: 'RETOURS',       path: '/retours',       icon: 'receipt',   ordre: 15 },
  { name: 'Configuration',   code: 'CONFIG',        path: '/config',        icon: 'settings',  ordre: 14 },
];

// Fonction réutilisable (appelée aussi par runSeed.js)
async function seedMenus() {
  for (const m of DEFAULT_MENUS) {
    await Menu.findOrCreate({ where: { code: m.code }, defaults: m });
  }
  return DEFAULT_MENUS.length;
}

module.exports = seedMenus;
module.exports.DEFAULT_MENUS = DEFAULT_MENUS;

// Exécution directe : `npm run seed:menus`
if (require.main === module) {
  (async () => {
    try {
      await sequelize.authenticate();
      const n = await seedMenus();
      logger.info('[seed] menus', { initialises: n });
      process.exit(0);
    } catch (e) {
      logger.error('[seed] menus en échec', { message: e.message, stack: e.stack });
      process.exit(1);
    }
  })();
}
