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
      console.log(`[SEED] ${n} catégorie(s) créée(s), ${REFERENTIEL_CATEGORIES.length} au référentiel.`);
      process.exit(0);
    } catch (e) {
      console.error(e);
      process.exit(1);
    }
  })();
}
