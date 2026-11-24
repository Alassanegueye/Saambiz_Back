// Caractéristiques produit suggérées par catégorie.
//
// Principe : c'est le VENDEUR qui remplit. La catégorie propose seulement
// des cases vides bien nommées — « Tailles », « Parfums », « Formats »… —
// et le vendeur y tape ses propres valeurs (« Bissap », « 1,5 L », « XL »).
// Aucune liste imposée, aucun champ obligatoire : publier un produit doit
// rester rapide. Le vendeur peut aussi ajouter ses propres caractéristiques
// (« Saveur », « Pointure enfant »…) depuis le formulaire produit.
//
// Ces suggestions sont posées par migration ; l'admin les ajuste ensuite
// depuis le dashboard (Catégories → Modifier → Caractéristiques).
//
// Types :
//   variantes  plusieurs valeurs proposées AU CLIENT, qui en choisit une à
//              la commande (tailles, parfums, formats…). Stocké en tableau.
//   texte      une information libre (matière, marque, zone…).
// Les types `liste`, `choix`, `nombre` et `oui_non` restent disponibles pour
// l'admin, mais ne sont pas utilisés par défaut.

const v = (cle, libelle, aide) => ({ cle, libelle, type: 'variantes', options: [], libre: true, ...(aide ? { aide } : {}) });
const t = (cle, libelle, aide) => ({ cle, libelle, type: 'texte', ...(aide ? { aide } : {}) });

const tailles = v('tailles', 'Tailles', 'Ex. S, M, L, XL');
// Les vêtements proposent les tailles courantes à cocher ; le vendeur peut
// toujours taper la sienne (« 46 », « Taille unique »).
const taillesVetements = { ...tailles, options: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL'] };
const couleurs = v('couleurs', 'Couleurs', 'Ex. Noir, Blanc, Rouge');

const SPECIFICATIONS_CATEGORIES = {
  // Le tissu n'est plus une case des vêtements : il a sa propre catégorie.
  'mode-femme': [taillesVetements, couleurs],
  'mode-homme': [taillesVetements, couleurs],
  tissus: [
    {
      cle: 'unite', libelle: 'Vendu au', type: 'choix', obligatoire: true, aide: "L'unité de votre prix",
      options: ['Mètre', 'Yard', 'Pièce de 6 yards', 'Demi-pièce (3 yards)', 'Coupon', 'Rouleau'],
    },
    t('matiere', 'Type de tissu', 'Ex. wax, bazin riche, getzner, soie, lin'),
    v('modeles', 'Modèles ou motifs', 'Ex. motif fleuri, motif 2, uni'),
    couleurs,
    t('largeur', 'Largeur du tissu', 'Ex. 1,15 m'),
  ],
  'chaussures-sacs': [v('pointures', 'Pointures', 'Ex. 38, 39, 40'), couleurs, t('matiere', 'Matière')],
  'beaute-cosmetiques': [v('contenances', 'Contenances', 'Ex. 100 ml, 250 ml'), v('teintes', 'Teintes ou parfums')],
  'bijoux-accessoires': [tailles, couleurs, t('matiere', 'Matière', 'Ex. or, argent, perles')],
  'telephones-electronique': [
    t('marque', 'Marque', 'Ex. Samsung, Tecno'),
    t('etat', 'État', 'Ex. neuf, occasion'),
    v('capacites', 'Capacités', 'Ex. 64 Go, 128 Go'),
    couleurs,
    t('garantie', 'Garantie', 'Ex. 6 mois'),
  ],
  'maison-deco': [v('dimensions', 'Dimensions', 'Ex. 120 × 60 cm'), couleurs, t('matiere', 'Matière')],
  'alimentation-epicerie': [v('formats', 'Poids ou formats', 'Ex. 1 kg, 5 kg, 25 kg')],
  'plats-traiteur': [v('portions', 'Portions', 'Ex. petite, grande, familiale'), v('accompagnements', 'Accompagnements', 'Ex. riz, attiéké, frites')],
  'jus-boissons': [v('parfums', 'Parfums', 'Ex. bissap, bouye, gingembre'), v('formats', 'Formats', 'Ex. 50 cl, 1 L, 1,5 L')],
  'patisserie-gateaux': [v('tailles', 'Tailles', 'Ex. 6 parts, 10 parts'), v('parfums', 'Parfums', 'Ex. vanille, chocolat')],
  'enfants-bebes': [v('ages', 'Âges ou tailles', 'Ex. 0-3 mois, 2 ans, 4 ans'), couleurs],
  'sante-bien-etre': [v('contenances', 'Contenances', 'Ex. 60 gélules, 500 ml')],
  'sport-loisirs': [taillesVetements, couleurs],
  artisanat: [couleurs, t('dimensions', 'Dimensions'), t('matiere', 'Matière')],
  services: [v('formules', 'Formules', 'Ex. simple, complète'), t('zone', 'Zone', 'Ex. Dakar et banlieue')],
  autre: [],
};

module.exports = { SPECIFICATIONS_CATEGORIES };
