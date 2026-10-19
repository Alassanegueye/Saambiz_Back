// Catégories : fonctions pures (pas de base de données).
const { slugifier, REFERENTIEL_CATEGORIES, ALIAS_CATEGORIES, MAX_CATEGORIES_BOUTIQUE } = require('../../src/constants/categories');
const CategorieBoutiqueService = require('../../src/services/categories/categorieBoutique.service');

describe('Référentiel des catégories', () => {
  test('slugs uniques, ordre continu, slug = slugifier(nom) hors exceptions', () => {
    const slugs = REFERENTIEL_CATEGORIES.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    REFERENTIEL_CATEGORIES.forEach((c, i) => expect(c.ordre).toBe(i + 1));
  });

  test('chaque alias pointe vers un slug du référentiel', () => {
    const slugs = new Set(REFERENTIEL_CATEGORIES.map((c) => c.slug));
    Object.values(ALIAS_CATEGORIES).flat().forEach((s) => expect(slugs.has(s)).toBe(true));
  });

  test('slugifier retire accents et ponctuation', () => {
    expect(slugifier('Beauté & cosmétiques')).toBe('beaute-cosmetiques');
    expect(slugifier('  Pièces   auto ! ')).toBe('pieces-auto');
  });

  test('plafond de 3 catégories par boutique', () => {
    expect(MAX_CATEGORIES_BOUTIQUE).toBe(3);
  });
});

describe('CategorieBoutiqueService.lireValeurs', () => {
  const lire = (...a) => CategorieBoutiqueService.lireValeurs(...a);
  test('tableau', () => expect(lire(['a', ' b ', ''])).toEqual(['a', 'b']));
  test('chaîne JSON (multipart)', () => expect(lire('["mode-femme","autre"]')).toEqual(['mode-femme', 'autre']));
  test('liste séparée par des virgules', () => expect(lire('mode-femme, autre')).toEqual(['mode-femme', 'autre']));
  test('ancien champ categorie seul', () => expect(lire(undefined, 'Mode')).toEqual(['Mode']));
  test('categories prime sur categorie', () => expect(lire(['services'], 'Mode')).toEqual(['services']));
  test('rien', () => expect(lire(undefined, '')).toEqual([]));
});
