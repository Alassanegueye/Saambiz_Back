// Seed des catégories SaamBiz — un seul niveau (voir src/constants/categories.js).
// Réutilisable par runSeed.js / bootstrap.js ou lançable seul :
//   `node src/seed/seedCategories.js`
//
// Idempotent et respectueux du dashboard : une catégorie déjà présente
// (même slug, ou même nom) n'est jamais modifiée — l'admin a pu la renommer,
// la masquer ou la réordonner. Seules les catégories absentes sont créées.
require('dotenv').config();
const { Op } = require('sequelize');
const { sequelize, Categorie } = require('../models');
const { REFERENTIEL_CATEGORIES } = require('../constants/categories');
const { SPECIFICATIONS_CATEGORIES } = require('../constants/specificationsCategories');
const logger = require('../utils/logger');

async function seedCategories() {
  let creees = 0;
  for (const c of REFERENTIEL_CATEGORIES) {
    const existe = await Categorie.findOne({
      where: { [Op.or]: [{ slug: c.slug }, { nom: c.nom }] },
      paranoid: false, // supprimée par l'admin : on ne la recrée pas
    });
    if (existe) continue;
    await Categorie.create({
      ...c, active: true, specifications: SPECIFICATIONS_CATEGORIES[c.slug] || [],
    });
    creees += 1;
  }
  return creees;
}

module.exports = seedCategories;
module.exports.DEFAULT_CATEGORIES = REFERENTIEL_CATEGORIES;

// Exécution directe
if (require.main === module) {
  (async () => {
    try {
      await sequelize.authenticate();
      const n = await seedCategories();
      logger.info('[seed] catégories', { creees: n, referentiel: REFERENTIEL_CATEGORIES.length });
      process.exit(0);
    } catch (e) {
      // La pile, et non l'objet brut : c'est elle qui dit où cela a cassé.
      logger.error('[seed] catégories en échec', { message: e.message, stack: e.stack });
      process.exit(1);
    }
  })();
}
