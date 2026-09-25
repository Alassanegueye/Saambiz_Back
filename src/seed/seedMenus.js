require('dotenv').config();
const { sequelize, Menu } = require('../models');

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
  { name: 'Signalements',    code: 'SIGNALEMENTS',  path: '/signalements',  icon: 'report',    ordre: 11 },
  { name: 'Administrateurs', code: 'ADMINS',        path: '/admins',        icon: 'admin',     ordre: 12 },
  { name: 'Menus',           code: 'MENUS',         path: '/menus',         icon: 'menu',      ordre: 13 },
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
      console.log(`[SEED] ${n} menus initialisés.`);
      process.exit(0);
    } catch (e) {
      console.error(e);
      process.exit(1);
    }
  })();
}
