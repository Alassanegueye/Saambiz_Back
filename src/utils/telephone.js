/**
 * Numéros de téléphone : pays acceptés et règles de chacun.
 *
 * Même liste que l'application mobile (Mobile/lib/core/utils/telephone.dart) :
 * les deux doivent rester alignées. Les numéros sont enregistrés au format
 * international (« +221771234567 »).
 */

const PAYS = [
  { code: 'SN', nom: 'Sénégal', adjectif: 'sénégalais', indicatif: '221', longueur: 9, debuts: ['70', '71', '75', '76', '77', '78', '33'] },
  { code: 'ML', nom: 'Mali', adjectif: 'malien', indicatif: '223', longueur: 8, debuts: ['2', '4', '5', '6', '7', '8', '9'] },
  { code: 'CI', nom: "Côte d'Ivoire", adjectif: 'ivoirien', indicatif: '225', longueur: 10, debuts: ['01', '05', '07', '21', '25', '27'] },
  { code: 'GN', nom: 'Guinée', adjectif: 'guinéen', indicatif: '224', longueur: 9, debuts: ['6', '3'] },
  { code: 'MR', nom: 'Mauritanie', adjectif: 'mauritanien', indicatif: '222', longueur: 8, debuts: ['2', '3', '4'] },
  { code: 'GM', nom: 'Gambie', adjectif: 'gambien', indicatif: '220', longueur: 7, debuts: [] },
  { code: 'BF', nom: 'Burkina Faso', adjectif: 'burkinabè', indicatif: '226', longueur: 8, debuts: [] },
  { code: 'MA', nom: 'Maroc', adjectif: 'marocain', indicatif: '212', longueur: 9, debuts: ['5', '6', '7'] },
  { code: 'FR', nom: 'France', adjectif: 'français', indicatif: '33', longueur: 9, debuts: ['1', '2', '3', '4', '5', '6', '7', '9'] },
];

// L'indicatif le plus long d'abord : « 221 » avant « 22 »…
const PAR_INDICATIF = [...PAYS].sort((a, b) => b.indicatif.length - a.indicatif.length);

/**
 * Met un numéro au format international. « 77 123 45 67 », « 00221771234567 »
 * et « +221 77 123 45 67 » donnent tous « +221771234567 ». Un numéro de
 * 9 chiffres sans indicatif est sénégalais. Chaîne vide si rien n'est saisi.
 */
function normaliserTelephone(brut) {
  let t = String(brut ?? '').replace(/[^\d+]/g, '');
  if (!t) return '';
  if (t.startsWith('00')) t = `+${t.slice(2)}`;
  if (!t.startsWith('+')) {
    if (/^\d{9}$/.test(t)) t = `+221${t}`;
    else if (/^221\d{9}$/.test(t)) t = `+${t}`;
    // Indicatif tapé sans « + » (« 22377… ») ; sinon, numéro sénégalais
    // mal saisi : l'erreur parlera de 9 chiffres.
    else if (PAYS.some((p) => t.startsWith(p.indicatif) && t.length === p.indicatif.length + p.longueur)) t = `+${t}`;
    else t = `+221${t}`;
  }
  // « +33 06… » : le 0 national n'a pas sa place après l'indicatif.
  const pays = PAR_INDICATIF.find((p) => t.startsWith(`+${p.indicatif}`));
  if (pays) {
    const national = t.slice(pays.indicatif.length + 1);
    if (national.startsWith('0') && national.length === pays.longueur + 1 && pays.code !== 'CI') {
      t = `+${pays.indicatif}${national.slice(1)}`;
    }
  }
  return t;
}

/**
 * Vérifie un numéro (normalisé ou non).
 * @returns {string|null} message d'erreur, ou null s'il est valable
 */
function erreurTelephone(brut) {
  const t = normaliserTelephone(brut);
  if (!t) return 'Numéro de téléphone requis.';
  const pays = PAR_INDICATIF.find((p) => t.startsWith(`+${p.indicatif}`));
  if (!pays) return 'Ce pays n\'est pas encore pris en charge pour les numéros de téléphone.';
  const national = t.slice(pays.indicatif.length + 1);
  if (!/^\d+$/.test(national) || national.length !== pays.longueur) {
    return `Un numéro ${pays.adjectif} compte ${pays.longueur} chiffres.`;
  }
  if (pays.debuts.length && !pays.debuts.some((d) => national.startsWith(d))) {
    return `Ce numéro ne correspond pas à un numéro ${pays.adjectif}.`;
  }
  return null;
}

/**
 * Formes sous lesquelles un même numéro peut être enregistré : le format
 * international, et l'ancien format local à 9 chiffres pour le Sénégal
 * (comptes créés avant la normalisation).
 */
function variantesTelephone(brut) {
  const t = normaliserTelephone(brut);
  if (!t) return [];
  const variantes = [t];
  if (/^\+221\d{9}$/.test(t)) variantes.push(t.slice(4));
  return variantes;
}

module.exports = { PAYS, normaliserTelephone, erreurTelephone, variantesTelephone };
