// Seed des catégories génériques de la marketplace Jëndal.
// Marketplace généraliste : tout vendeur, tout type de produit.
// Réutilisable par runSeed.js ou lançable seul : `node src/seed/seedCategories.js`
require('dotenv').config();
const { sequelize, Categorie } = require('../models');

const DEFAULT_CATEGORIES = [
  { nom: 'Mode & Vêtements',       description: 'Vêtements, chaussures et accessoires de mode' },
  { nom: 'Beauté & Cosmétiques',   description: 'Soins, maquillage, parfums et produits de beauté' },
  { nom: 'Électronique',           description: 'Téléphones, accessoires et appareils électroniques' },
  { nom: 'Maison & Déco',          description: 'Décoration, meubles et articles pour la maison' },
  { nom: 'Alimentation',           description: 'Produits alimentaires, boissons et épicerie' },
  { nom: 'Sport & Loisirs',        description: 'Équipements de sport, loisirs et plein air' },
  { nom: 'Enfants & Bébé',         description: 'Vêtements, jouets et articles pour enfants et bébés' },
  { nom: 'Bijoux & Accessoires',   description: 'Bijoux, montres et accessoires' },
  { nom: 'Artisanat & Fait main',  description: 'Créations artisanales et produits faits main' },
  { nom: 'Santé & Bien-être',      description: 'Produits de santé, hygiène et bien-être' },
  { nom: 'Services',               description: 'Prestations et services proposés par les vendeurs' },
  { nom: 'Autres',                 description: 'Produits divers ne rentrant dans aucune autre catégorie' },
];

async function seedCategories() {
  for (const c of DEFAULT_CATEGORIES) {
    await Categorie.findOrCreate({ where: { nom: c.nom }, defaults: c });
  }
  return DEFAULT_CATEGORIES.length;
}

module.exports = seedCategories;
module.exports.DEFAULT_CATEGORIES = DEFAULT_CATEGORIES;

// Exécution directe
if (require.main === module) {
  (async () => {
    try {
      await sequelize.authenticate();
      const n = await seedCategories();
      console.log(`[SEED] ${n} catégories initialisées.`);
      process.exit(0);
    } catch (e) {
      console.error(e);
      process.exit(1);
    }
  })();
}
