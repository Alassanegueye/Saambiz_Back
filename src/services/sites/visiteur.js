// services/sites/visiteur.js
//
// Ce qu'on peut savoir d'un visiteur sans le pister : son appareil, son
// navigateur, d'où il vient, son pays probable, son adresse tronquée. Repris
// du site Kodafrik (public/api/_commun.php), pour que les chiffres restent
// comparables d'un hébergement à l'autre.

const net = require('net');

/** Texte propre et borné, ou null. */
function texte(valeur, max = 200) {
  if (valeur === null || valeur === undefined || typeof valeur === 'object') return null;
  const v = String(valeur)
    .replace(/<[^>]*>/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
  return v === '' ? null : Array.from(v).slice(0, max).join('');
}

/** Une valeur sur une ligne (en-têtes d'e-mail, noms) : ni retour ni tabulation. */
function ligne(valeur, max = 200) {
  const v = texte(valeur, max);
  return v === null ? null : v.replace(/[\r\n\t]+/g, ' ').trim() || null;
}

/** Appareil, navigateur et système, lus dans l'en-tête User-Agent. */
function lireAgent(ua = '') {
  const s = String(ua || '');
  const appareil = /iPad|Tablet|(Android(?!.*Mobile))/i.test(s)
    ? 'Tablette'
    : /Mobi|iPhone|Android/i.test(s) ? 'Mobile' : 'Ordinateur';

  let navigateur = 'Autre';
  if (/Edg\//.test(s)) navigateur = 'Edge';
  else if (/OPR\/|Opera/.test(s)) navigateur = 'Opera';
  else if (/SamsungBrowser/.test(s)) navigateur = 'Samsung Internet';
  else if (/FBAN|FBAV|FB_IAB/.test(s)) navigateur = 'Facebook (in-app)';
  else if (/Instagram/.test(s)) navigateur = 'Instagram (in-app)';
  else if (/Firefox\//.test(s)) navigateur = 'Firefox';
  else if (/Chrome\//.test(s)) navigateur = 'Chrome';
  else if (/Safari\//.test(s)) navigateur = 'Safari';

  let os = 'Autre';
  if (/Windows/.test(s)) os = 'Windows';
  else if (/iPhone|iPad|iPod/.test(s)) os = 'iOS';
  else if (/Mac OS X/.test(s)) os = 'macOS';
  else if (/Android/.test(s)) os = 'Android';
  else if (/Linux/.test(s)) os = 'Linux';

  return { appareil, navigateur, os };
}

/**
 * L'application mobile SaamBiz (Flutter) se présente comme « Dart/3.x
 * (dart:io) » : ni navigateur ni système à en tirer.
 */
const estApplication = (ua = '') => /\bDart\/|dart:io|okhttp|CFNetwork/i.test(String(ua || ''));

const SOURCES_CONNUES = [
  ['google.', 'Google'], ['bing.', 'Bing'], ['yahoo.', 'Yahoo'], ['duckduckgo.', 'DuckDuckGo'],
  ['facebook.', 'Facebook'], ['fb.', 'Facebook'], ['instagram.', 'Instagram'],
  ['linkedin.', 'LinkedIn'], ['lnkd.', 'LinkedIn'], ['t.co', 'X (Twitter)'], ['twitter.', 'X (Twitter)'], ['x.com', 'X (Twitter)'],
  ['tiktok.', 'TikTok'], ['youtube.', 'YouTube'], ['whatsapp.', 'WhatsApp'], ['wa.me', 'WhatsApp'],
  ['chatgpt.', 'ChatGPT'], ['openai.', 'ChatGPT'], ['perplexity.', 'Perplexity'],
];

/** D'où vient le visiteur : un nom lisible plutôt qu'une adresse. */
function lireSource(referent, utmSource, domaine) {
  if (utmSource) return String(utmSource).slice(0, 60);
  if (!referent) return 'Accès direct';
  let hote = '';
  try {
    hote = new URL(referent).hostname.toLowerCase();
  } catch {
    return 'Accès direct';
  }
  if (!hote) return 'Accès direct';
  hote = hote.replace(/^(www|m|l|lm)\./, '');
  for (const [motif, nom] of SOURCES_CONNUES) {
    if (hote.startsWith(motif) || hote.includes(`.${motif}`) || hote === motif.replace(/\.$/, '')) return nom;
  }
  if (domaine && (hote === domaine || hote.endsWith(`.${domaine}`))) return 'Accès direct';
  return hote.slice(0, 80);
}

/** Le pays : en-tête du proxy s'il existe, sinon la région de la langue du navigateur. */
function lirePays(langue, entetes = {}) {
  for (const cle of ['cf-ipcountry', 'geoip-country-code', 'x-country-code']) {
    const v = String(entetes[cle] || '').toUpperCase();
    if (/^[A-Z]{2}$/.test(v) && v !== 'XX') return v;
  }
  const m = /^[a-z]{2,3}[-_]([A-Za-z]{2})\b/.exec(String(langue || ''));
  return m ? m[1].toUpperCase() : null;
}

/** IPv4 sans son dernier octet, IPv6 sans ses 80 derniers bits. */
function ipAnonyme(ip) {
  let a = String(ip || '').trim();
  if (a.startsWith('::ffff:') && net.isIPv4(a.slice(7))) a = a.slice(7);
  if (net.isIPv4(a)) return a.replace(/\.\d+$/, '.0');
  if (net.isIPv6(a)) {
    // Développe « a:b::c » en huit groupes, garde les trois premiers.
    const [gauche, droite = ''] = a.split('::');
    const g = gauche ? gauche.split(':') : [];
    const d = droite ? droite.split(':') : [];
    const groupes = a.includes('::') ? [...g, ...Array(8 - g.length - d.length).fill('0'), ...d] : g;
    return `${groupes.slice(0, 3).map((x) => x.replace(/^0+(?=.)/, '').toLowerCase()).join(':')}::`;
  }
  return null;
}

/** Adresse e-mail plausible (la même exigence que le formulaire du site). */
const estEmail = (v) => typeof v === 'string' && v.length <= 180 && /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[a-z]{2,}$/i.test(v);

module.exports = { texte, ligne, lireAgent, estApplication, lireSource, lirePays, ipAnonyme, estEmail };
