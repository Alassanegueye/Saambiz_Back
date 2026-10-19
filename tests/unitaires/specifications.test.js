// Caractéristiques produit : suggestions par catégorie, remplies par le vendeur.
const { normaliserSchema, validerAttributs } = require('../../src/services/categories/specifications');
const { SPECIFICATIONS_CATEGORIES } = require('../../src/constants/specificationsCategories');
const { REFERENTIEL_CATEGORIES } = require('../../src/constants/categories');

const spec = (slug) => normaliserSchema(SPECIFICATIONS_CATEGORIES[slug]);

describe('Suggestions par catégorie', () => {
  test('chaque catégorie a une entrée valide, sans liste imposée ni champ obligatoire', () => {
    for (const c of REFERENTIEL_CATEGORIES) {
      expect(SPECIFICATIONS_CATEGORIES).toHaveProperty(c.slug);
      for (const champ of spec(c.slug)) {
        expect(champ.obligatoire).toBeUndefined();
        expect(champ.options || []).toEqual([]);
      }
    }
  });
});

describe('validerAttributs', () => {
  test('rien n\'est obligatoire : un produit sans caractéristique passe', () => {
    expect(validerAttributs(spec('jus-boissons'), {})).toEqual({});
  });

  test('le vendeur tape ses propres valeurs (doublons retirés, « 1,5 L » intact)', () => {
    const v = validerAttributs(spec('jus-boissons'), {
      parfums: ['Bissap', 'bissap', 'Bouye'], formats: '50 cl, 1,5 L',
    });
    expect(v).toEqual({ parfums: ['Bissap', 'Bouye'], formats: ['50 cl', '1,5 L'] });
  });

  test('caractéristiques ajoutées par le vendeur conservées et bornées', () => {
    const v = validerAttributs(spec('patisserie-gateaux'), JSON.stringify({
      tailles: ['8 parts'], Glaçage: ['Chocolat', ''], 'Message sur le gâteau': 'Possible', vide: [], objet: { a: 1 },
    }));
    expect(v).toEqual({ tailles: ['8 parts'], Glaçage: ['Chocolat'], 'Message sur le gâteau': 'Possible' });
    const trop = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`c${i}`, 'x']));
    expect(Object.keys(validerAttributs([], trop))).toHaveLength(10);
  });

  test('un champ défini par l\'admin avec options et obligation reste vérifié', () => {
    const s = normaliserSchema([{ libelle: 'État', type: 'choix', options: ['Neuf', 'Occasion'], obligatoire: true }]);
    expect(() => validerAttributs(s, {})).toThrow(/État/);
    expect(() => validerAttributs(s, { etat: 'Cassé' })).toThrow(/État/);
    expect(validerAttributs(s, { etat: 'neuf' })).toEqual({ etat: 'Neuf' });
  });
});

describe('normaliserSchema (dashboard)', () => {
  test('clé dérivée du libellé, options en texte acceptées', () => {
    const s = normaliserSchema([{ libelle: 'Épaisseur du tissu', type: 'choix', options: 'Fin, Épais, fin' }]);
    expect(s).toEqual([{ cle: 'epaisseur_du_tissu', libelle: 'Épaisseur du tissu', type: 'choix', options: ['Fin', 'Épais'] }]);
  });
  test('« 1,5 L » reste une seule option', () => {
    const s = normaliserSchema([{ libelle: 'Formats', type: 'variantes', options: '50 cl, 1 L, 1,5 L, 5 L' }]);
    expect(s[0].options).toEqual(['50 cl', '1 L', '1,5 L', '5 L']);
  });
  test('refus : type inconnu, choix sans option', () => {
    expect(() => normaliserSchema([{ libelle: 'X', type: 'couleur' }])).toThrow(/type inconnu/);
    expect(() => normaliserSchema([{ libelle: 'X', type: 'choix', options: [] }])).toThrow(/option/);
  });
});
