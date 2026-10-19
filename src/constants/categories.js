// Référentiel des catégories SaamBiz — un seul niveau, pas de sous-rayons.
//
// Source unique pour le seed et pour la traduction des anciens libellés.
// La migration 20261019_structure_categories.sql porte la même liste : elle
// installe les catégories sur une base existante, le seed les recrée sur une
// base neuve. Une fois en place, tout se gère depuis le dashboard admin
// (renommer, masquer, réordonner) : cette liste n'est plus relue ensuite.

const REFERENTIEL_CATEGORIES = [
  { slug: 'mode-femme',              nom: 'Mode femme',                icone: 'checkroom',       description: 'Robes, boubous, pagnes, ensembles et prêt-à-porter femme' },
  { slug: 'mode-homme',              nom: 'Mode homme',                icone: 'man',             description: 'Chemises, pantalons, boubous et prêt-à-porter homme' },
  { slug: 'chaussures-sacs',         nom: 'Chaussures & sacs',         icone: 'shopping_bag',    description: 'Chaussures, sandales, sacs et maroquinerie' },
  { slug: 'beaute-cosmetiques',      nom: 'Beauté & cosmétiques',      icone: 'spa',             description: 'Soins, maquillage, parfums, cheveux et mèches' },
  { slug: 'bijoux-accessoires',      nom: 'Bijoux & accessoires',      icone: 'diamond',         description: 'Bijoux, montres, lunettes et accessoires' },
  { slug: 'telephones-electronique', nom: 'Téléphones & électronique', icone: 'smartphone',      description: 'Téléphones, accessoires, informatique et électroménager' },
  { slug: 'maison-deco',             nom: 'Maison & déco',             icone: 'chair',           description: 'Décoration, linge de maison, cuisine et mobilier' },
  { slug: 'alimentation-epicerie',   nom: 'Alimentation & épicerie',   icone: 'shopping_basket', description: 'Épicerie, céréales, produits frais et produits locaux à cuisiner' },
  // Vendeurs de nourriture et de boissons : des catégories à part, un client
  // qui cherche son déjeuner ou un jus ne cherche pas une épicerie.
  { slug: 'plats-traiteur',          nom: 'Plats & traiteur',          icone: 'restaurant',      description: 'Plats cuisinés, plats du jour, fast-food, traiteur et repas livrés' },
  { slug: 'jus-boissons',            nom: 'Jus & boissons',            icone: 'local_drink',     description: 'Bissap, bouye, gingembre, ditakh, jus frais et boissons' },
  { slug: 'patisserie-gateaux',      nom: 'Pâtisserie & gâteaux',      icone: 'cake',            description: "Gâteaux, pâtisseries, beignets, desserts et commandes d'événements" },
  { slug: 'enfants-bebes',           nom: 'Enfants & bébés',           icone: 'child_care',      description: 'Vêtements, jouets et puériculture' },
  { slug: 'sante-bien-etre',         nom: 'Santé & bien-être',         icone: 'favorite',        description: 'Hygiène, parapharmacie et bien-être' },
  { slug: 'sport-loisirs',           nom: 'Sport & loisirs',           icone: 'sports_soccer',   description: 'Équipements de sport, loisirs et plein air' },
  { slug: 'artisanat',               nom: 'Artisanat & fait main',     icone: 'palette',         description: 'Créations artisanales et produits faits main' },
  { slug: 'services',                nom: 'Services',                  icone: 'handyman',        description: 'Couture, coiffure, réparation et autres prestations' },
  { slug: 'autre',                   nom: 'Autre',                     icone: 'more_horiz',      description: 'Ce qui ne rentre dans aucune autre catégorie' },
].map((c, i) => ({ ...c, ordre: i + 1 }));

// Anciens libellés → slugs. Les versions précédentes de l'application
// envoyaient 'Mode', 'Beauté'… ; elles continuent de fonctionner tant
// qu'elles ne sont pas mises à jour. Le premier slug est la catégorie
// principale quand un libellé en donne plusieurs.
const ALIAS_CATEGORIES = {
  'mode & vêtements': ['mode-femme', 'mode-homme'],
  mode: ['mode-femme', 'mode-homme'],
  'vêtements': ['mode-femme', 'mode-homme'],
  chaussures: ['chaussures-sacs'],
  sacs: ['chaussures-sacs'],
  'beauté': ['beaute-cosmetiques'],
  beaute: ['beaute-cosmetiques'],
  'cosmétiques': ['beaute-cosmetiques'],
  'électronique': ['telephones-electronique'],
  electronique: ['telephones-electronique'],
  'téléphones': ['telephones-electronique'],
  maison: ['maison-deco'],
  alimentation: ['alimentation-epicerie'],
  'épicerie': ['alimentation-epicerie'],
  nourriture: ['plats-traiteur'],
  restaurant: ['plats-traiteur'],
  restauration: ['plats-traiteur'],
  traiteur: ['plats-traiteur'],
  plats: ['plats-traiteur'],
  cuisine: ['plats-traiteur'],
  jus: ['jus-boissons'],
  boissons: ['jus-boissons'],
  'pâtisserie': ['patisserie-gateaux'],
  patisserie: ['patisserie-gateaux'],
  'gâteaux': ['patisserie-gateaux'],
  'enfants & bébé': ['enfants-bebes'],
  enfants: ['enfants-bebes'],
  bijoux: ['bijoux-accessoires'],
  'santé': ['sante-bien-etre'],
  sport: ['sport-loisirs'],
  artisanat: ['artisanat'],
  autres: ['autre'],
};

// Une boutique se range dans 1 à 3 catégories : au-delà, elle apparaîtrait
// partout et le filtre par catégorie ne voudrait plus rien dire.
const MAX_CATEGORIES_BOUTIQUE = 3;

/** « Beauté & cosmétiques » → « beaute-cosmetiques ». */
function slugifier(texte) {
  return String(texte || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '')
    .slice(0, 70);
}

module.exports = {
  REFERENTIEL_CATEGORIES,
  ALIAS_CATEGORIES,
  MAX_CATEGORIES_BOUTIQUE,
  slugifier,
};
