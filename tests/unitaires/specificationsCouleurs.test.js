/**
 * Le type « couleurs » d'une spécification de catégorie.
 *
 * Avant lui, le vendeur tapait ses couleurs à la main dans un champ de
 * variantes : « Noir, Blanc, Rouge ». Trois conséquences, toutes visibles
 * par le client — ses fautes de frappe devenaient des choix, « rouge »,
 * « Rouge vif » et « bordeaux » désignaient la même étoffe sans qu'on
 * puisse les rapprocher, et la couleur ne pouvait pas être MONTRÉE, faute
 * de code.
 *
 * Ce type stocke un couple : le code vient du nuancier, le nom reste
 * librement écrit par le vendeur.
 */
const { normaliserSchema, validerAttributs } = require('../../src/services/categories/specifications');

const SCHEMA = normaliserSchema([{ libelle: 'Couleurs', type: 'couleurs' }]);

describe('Définition d’une spécification « couleurs »', () => {
  it('est acceptée sans aucune option à déclarer', () => {
    // Le nuancier est universel : l'administrateur n'a pas à énumérer les
    // teintes du monde, contrairement aux `variantes` qui exigent une liste.
    expect(SCHEMA).toEqual([{ cle: 'couleurs', libelle: 'Couleurs', type: 'couleurs' }]);
  });

  it('refuse encore un type inventé', () => {
    expect(() => normaliserSchema([{ libelle: 'Teintes', type: 'nuancier' }]))
      .toThrow(/type inconnu/i);
  });
});

describe('Couleurs saisies par le vendeur', () => {
  const valider = (couleurs) => validerAttributs(SCHEMA, { couleurs }).couleurs;

  it('garde le code et le nom', () => {
    expect(valider([{ code: '#F2B705', nom: 'Ocre' }]))
      .toEqual([{ code: '#f2b705', nom: 'Ocre' }]);
  });

  it('écarte un code qui n’en est pas un, sans perdre le nom', () => {
    // Le vendeur garde sa couleur nommée ; il lui manque la teinte.
    expect(valider([{ code: 'bleu-nuit', nom: 'Bleu nuit' }]))
      .toEqual([{ nom: 'Bleu nuit' }]);
  });

  it('accepte une ancienne valeur de type texte', () => {
    // Une catégorie passée de `variantes` à `couleurs` : les produits
    // existants portent encore « Noir, Rouge ». Les effacer au premier
    // enregistrement serait une mauvaise surprise.
    expect(valider('Noir, Rouge')).toEqual([{ nom: 'Noir' }, { nom: 'Rouge' }]);
  });

  it('ne garde pas deux fois la même teinte', () => {
    expect(valider([
      { code: '#000000', nom: 'Noir' },
      { code: '#000000', nom: 'Noir profond' },
    ])).toEqual([{ code: '#000000', nom: 'Noir' }]);
  });

  it('ne garde pas deux fois le même nom sans code', () => {
    expect(valider(['Noir', 'noir'])).toEqual([{ nom: 'Noir' }]);
  });

  it('ignore une entrée sans nom ni code', () => {
    expect(valider([{}, { nom: '   ' }, { code: '#111111', nom: '' }]))
      .toEqual([{ code: '#111111', nom: '#111111' }]);
  });

  it('retire la clé quand rien n’est choisi', () => {
    expect(validerAttributs(SCHEMA, { couleurs: [] }).couleurs).toBeUndefined();
  });

  it('réclame la valeur si la spécification est obligatoire', () => {
    const obligatoire = normaliserSchema([{ libelle: 'Couleurs', type: 'couleurs', obligatoire: true }]);
    expect(() => validerAttributs(obligatoire, { couleurs: [] }))
      .toThrow(/renseigner/i);
  });
});
