const { BadRequestError, ValidationError } = require('../../errors/AppError');

/**
 * Spécifications produit d'une catégorie — définition (dashboard admin) et
 * vérification des valeurs saisies par le vendeur.
 * Le format est décrit dans src/constants/specificationsCategories.js.
 */

const TYPES = ['variantes', 'liste', 'choix', 'texte', 'nombre', 'oui_non'];
const MAX_CHAMPS = 20;
const MAX_OPTIONS = 60;
// Caractéristiques que le vendeur ajoute lui-même, par produit.
const MAX_LIBRES = 10;

const versCle = (texte) => String(texte || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/(^_+|_+$)/g, '')
  .slice(0, 40);

// Virgule séparatrice, sauf entre deux chiffres : « 1,5 L » reste une
// seule valeur, « S, M, L » en donne trois.
const decouper = (texte) => String(texte).split(/,(?!\d)/);

/** Sans doublon (casse ignorée), en gardant la première écriture. */
const sansDoublon = (liste) => {
  const vues = new Set();
  return liste.filter((x) => {
    const k = x.toLowerCase();
    if (vues.has(k)) return false;
    vues.add(k);
    return true;
  });
};

const texteCourt = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

/** Nettoie un tableau d'options : textes non vides, sans doublon. */
function nettoyerOptions(options) {
  const brut = Array.isArray(options)
    ? options
    : (typeof options === 'string' ? decouper(options) : []);
  const vues = new Set();
  const propres = [];
  for (const o of brut) {
    const t = texteCourt(o, 40);
    if (t && !vues.has(t.toLowerCase())) { vues.add(t.toLowerCase()); propres.push(t); }
  }
  return propres.slice(0, MAX_OPTIONS);
}

/**
 * Vérifie et normalise une définition envoyée par le dashboard admin.
 * @returns {Array} définition propre
 */
function normaliserSchema(entree) {
  let liste = entree;
  if (typeof liste === 'string') {
    try { liste = JSON.parse(liste); } catch { throw new BadRequestError('Spécifications illisibles'); }
  }
  if (liste == null) return [];
  if (!Array.isArray(liste)) throw new BadRequestError('Les spécifications doivent être une liste');
  if (liste.length > MAX_CHAMPS) throw new BadRequestError(`${MAX_CHAMPS} spécifications au maximum par catégorie`);

  const cles = new Set();
  return liste.map((brut, i) => {
    const libelle = texteCourt(brut?.libelle, 60);
    if (!libelle) throw new BadRequestError(`Spécification n°${i + 1} : le libellé est requis`);
    const type = TYPES.includes(brut?.type) ? brut.type : null;
    if (!type) throw new BadRequestError(`« ${libelle} » : type inconnu`);

    let cle = versCle(brut?.cle) || versCle(libelle) || `champ_${i + 1}`;
    while (cles.has(cle)) cle = `${cle}_${i + 1}`;
    cles.add(cle);

    const champ = { cle, libelle, type };
    if (['variantes', 'liste', 'choix'].includes(type)) {
      champ.options = nettoyerOptions(brut?.options);
      if (type === 'variantes') champ.libre = brut?.libre === true || brut?.libre === 'true';
      if (!champ.options.length && !champ.libre) {
        throw new BadRequestError(`« ${libelle} » : ajoutez au moins une option`);
      }
    }
    if (type === 'nombre') {
      const unite = texteCourt(brut?.unite, 15);
      if (unite) champ.unite = unite;
    }
    if (brut?.obligatoire === true || brut?.obligatoire === 'true') champ.obligatoire = true;
    const aide = texteCourt(brut?.aide, 120);
    if (aide) champ.aide = aide;
    return champ;
  });
}

const estVide = (v) => v == null
  || (typeof v === 'string' && !v.trim())
  || (Array.isArray(v) && v.length === 0);

/**
 * Vérifie les valeurs saisies par le vendeur pour un produit.
 *
 * Les clés inconnues de la catégorie sont conservées : un vendeur peut avoir
 * défini ses propres variantes avant l'arrivée des spécifications, et les
 * perdre au premier enregistrement serait une mauvaise surprise.
 *
 * @param {Array}  schema     spécifications de la catégorie
 * @param {object} attributs  valeurs envoyées
 * @returns {object} valeurs normalisées
 */
function validerAttributs(schema, attributs) {
  let valeurs = attributs;
  if (typeof valeurs === 'string') {
    if (!valeurs.trim()) valeurs = {};
    else {
      try { valeurs = JSON.parse(valeurs); } catch {
        throw new ValidationError('Caractéristiques du produit illisibles', [{ champ: 'attributs', message: 'JSON invalide' }]);
      }
    }
  }
  if (valeurs == null) valeurs = {};
  if (typeof valeurs !== 'object' || Array.isArray(valeurs)) {
    throw new ValidationError('Caractéristiques du produit invalides', [{ champ: 'attributs', message: 'Objet attendu' }]);
  }

  const resultat = { ...valeurs };
  const erreurs = [];

  for (const champ of Array.isArray(schema) ? schema : []) {
    const brut = valeurs[champ.cle];
    const options = champ.options || [];
    const dansOptions = (v) => options.some((o) => o.toLowerCase() === v.toLowerCase());
    const canonique = (v) => options.find((o) => o.toLowerCase() === v.toLowerCase()) || v;

    if (estVide(brut)) {
      delete resultat[champ.cle];
      if (champ.obligatoire && champ.type !== 'oui_non') {
        erreurs.push({ champ: champ.cle, message: `${champ.libelle} : à renseigner` });
      }
      continue;
    }

    switch (champ.type) {
      case 'variantes':
      case 'liste': {
        const liste = (Array.isArray(brut) ? brut : decouper(brut))
          .map((v) => texteCourt(v, 40)).filter(Boolean);
        const uniques = sansDoublon(liste.map(canonique));
        const horsListe = uniques.filter((v) => !dansOptions(v));
        if (horsListe.length && !(champ.type === 'variantes' && champ.libre)) {
          erreurs.push({ champ: champ.cle, message: `${champ.libelle} : valeur non proposée (${horsListe.join(', ')})` });
          break;
        }
        if (!uniques.length) {
          delete resultat[champ.cle];
          if (champ.obligatoire) erreurs.push({ champ: champ.cle, message: `${champ.libelle} : à renseigner` });
          break;
        }
        // Les variantes restent un tableau : c'est ce que la vitrine et
        // l'application proposent au client. Une liste n'est qu'une info.
        resultat[champ.cle] = champ.type === 'variantes' ? uniques.slice(0, MAX_OPTIONS) : uniques.join(', ');
        break;
      }
      case 'choix': {
        const v = texteCourt(Array.isArray(brut) ? brut[0] : brut, 60);
        if (!dansOptions(v)) {
          erreurs.push({ champ: champ.cle, message: `${champ.libelle} : choisissez parmi ${options.join(', ')}` });
          break;
        }
        resultat[champ.cle] = canonique(v);
        break;
      }
      case 'nombre': {
        const n = Number(String(brut).replace(',', '.'));
        if (!Number.isFinite(n) || n < 0) {
          erreurs.push({ champ: champ.cle, message: `${champ.libelle} : nombre attendu` });
          break;
        }
        resultat[champ.cle] = n;
        break;
      }
      case 'oui_non':
        resultat[champ.cle] = brut === true || brut === 'true' || brut === 1 || brut === '1' || brut === 'oui';
        break;
      default:
        resultat[champ.cle] = texteCourt(brut, 200);
    }
  }

  if (erreurs.length) {
    throw new ValidationError(erreurs.map((e) => e.message).join(' · '), erreurs);
  }

  // Caractéristiques ajoutées par le vendeur lui-même (« Saveur »…) : le nom
  // sert de clé. On les accepte, bornées pour que rien d'énorme n'entre.
  const connues = new Set((Array.isArray(schema) ? schema : []).map((c) => c.cle));
  let libres = 0;
  for (const cle of Object.keys(resultat)) {
    if (connues.has(cle)) continue;
    const nom = texteCourt(cle, 40);
    const brut = resultat[cle];
    delete resultat[cle];
    if (!nom || libres >= MAX_LIBRES) continue;
    let valeur;
    if (Array.isArray(brut)) {
      valeur = sansDoublon(brut.map((x) => texteCourt(x, 40)).filter(Boolean)).slice(0, MAX_OPTIONS);
      if (!valeur.length) continue;
    } else if (typeof brut === 'string' || typeof brut === 'number') {
      valeur = texteCourt(brut, 200);
      if (!valeur) continue;
    } else if (typeof brut === 'boolean') {
      valeur = brut;
    } else continue;
    resultat[nom] = valeur;
    libres += 1;
  }
  return resultat;
}

module.exports = { TYPES, normaliserSchema, validerAttributs, versCle };
