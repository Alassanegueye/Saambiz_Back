// Modèle de boutique par défaut.
// Garantit qu'une boutique créée par n'importe quel vendeur est cohérente
// et immédiatement exploitable, quel que soit son type d'activité.
const { Boutique } = require('../models');

// Valeurs par défaut appliquées si le vendeur ne les fournit pas.
const DEFAUTS_BOUTIQUE = {
  couleur_theme: '#0D1B3D',            // bleu marine de la charte SaamBiz
  statut: 'actif',                     // visible immédiatement
  slogan: 'Bienvenue dans ma boutique 👋',
  categorie: 'Autres',                 // catégorie neutre par défaut
  description: 'Boutique en ligne sur SaamBiz.',
};

// Applique les valeurs par défaut aux champs vides/absents.
function appliquerDefautsBoutique(data = {}) {
  const out = { ...data };
  for (const [cle, valeur] of Object.entries(DEFAUTS_BOUTIQUE)) {
    if (out[cle] === undefined || out[cle] === null || out[cle] === '') {
      out[cle] = valeur;
    }
  }
  return out;
}

// Génère un slug unique et lisible à partir du nom de la boutique.
async function genererSlugUnique(nom) {
  const base = String(nom || 'boutique')
    .toLowerCase()
    .normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '') // enlève les accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60) || 'boutique';

  let slug = base;
  let i = 1;
  // eslint-disable-next-line no-await-in-loop
  while (await Boutique.findOne({ where: { slug }, paranoid: false })) {
    slug = `${base}-${i++}`;
  }
  return slug;
}

module.exports = { DEFAUTS_BOUTIQUE, appliquerDefautsBoutique, genererSlugUnique };
