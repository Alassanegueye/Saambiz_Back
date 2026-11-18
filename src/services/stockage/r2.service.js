'use strict';

/**
 * r2.service.js — Stockage Cloudflare R2 (compatible S3), repris de Widjila.
 *
 * Deux espaces, comme sur Widjila :
 *   - le bucket PUBLIC (R2_BUCKET_NAME), servi par son adresse publique
 *     (R2_PUBLIC_URL : domaine personnalisé ou r2.dev). Photos de produits,
 *     logos, bannières, promotions, photos de profil, photos du site : tout
 *     ce que les clients voient. La base garde l'URL complète, comme elle
 *     gardait celle de Cloudinary : aucun client n'a à changer.
 *   - le bucket PRIVÉ (R2_PRIVATE_BUCKET_NAME), jamais exposé : pièces
 *     d'identité de la certification. La base garde la clé, et seul un
 *     lien signé de quelques minutes en donne l'accès (back-office).
 *
 * Variables : R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 * R2_BUCKET_NAME, R2_PUBLIC_URL, R2_PRIVATE_BUCKET_NAME.
 *
 * Le client est créé PARESSEUSEMENT, et les variables sont relues à chaque
 * appel : l'application démarre sans R2, et `upload.service.js` reste alors
 * sur Cloudinary.
 */

const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const path = require('path');
const logger = require('../../utils/logger');

let client = null;
let signatureClient = null;

const identifiantsPresents = () => Boolean(
  process.env.R2_ACCOUNT_ID
  && process.env.R2_ACCESS_KEY_ID
  && process.env.R2_SECRET_ACCESS_KEY
);

/** Adresse publique du bucket public, sans barre finale. */
function urlPublique() {
  return String(process.env.R2_PUBLIC_URL || '').trim().replace(/\/+$/, '');
}

/** Vrai si le bucket public est utilisable : identifiants, nom et adresse. */
function publicConfigure() {
  return identifiantsPresents() && Boolean(process.env.R2_BUCKET_NAME) && Boolean(urlPublique());
}

/** Vrai si le bucket privé est utilisable. */
function priveConfigure() {
  return identifiantsPresents() && Boolean(process.env.R2_PRIVATE_BUCKET_NAME);
}

function getClient() {
  const signature = [
    process.env.R2_ACCOUNT_ID,
    process.env.R2_ACCESS_KEY_ID,
    process.env.R2_SECRET_ACCESS_KEY,
  ].join('|');
  if (client && signature === signatureClient) return client;
  if (!identifiantsPresents()) return null;

  client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    // Délais, comme sur Widjila : sans eux, une connexion R2 qui ne s'établit
    // pas retenait indéfiniment la requête du vendeur. Sans
    // `throwOnRequestTimeout`, le SDK se contente d'un avertissement.
    requestHandler: {
      connectionTimeout: parseInt(process.env.R2_CONNECT_TIMEOUT_MS || '5000', 10),
      requestTimeout: parseInt(process.env.R2_REQUEST_TIMEOUT_MS || '60000', 10),
      throwOnRequestTimeout: true,
    },
    // Reprises du SDK sur les erreurs réseau et 5xx/429 seulement.
    maxAttempts: 3,
  });
  signatureClient = signature;
  return client;
}

function requireClient() {
  const c = getClient();
  if (!c) throw new Error('Stockage R2 non configuré (variables R2_* manquantes).');
  return c;
}

const bucket = (prive) => (prive ? process.env.R2_PRIVATE_BUCKET_NAME : process.env.R2_BUCKET_NAME);

// ── Types MIME ────────────────────────────────────────────────────────────────

/**
 * Posé à l'envoi pour que R2 le renvoie : sans lui, tout ressortirait en
 * application/octet-stream et le navigateur téléchargerait les photos au
 * lieu de les afficher.
 */
const TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
};

function contentType(nomFichier) {
  return TYPES[path.extname(nomFichier || '').toLowerCase()] || 'application/octet-stream';
}

// ── Clés ──────────────────────────────────────────────────────────────────────

/**
 * Clé d'un objet à partir d'une valeur stockée en base : URL publique R2,
 * clé nue, ou clé privée préfixée « prive: ». Null pour tout le reste
 * (Cloudinary, autre hébergeur) et pour une tentative de remontée.
 */
function versCle(valeur) {
  if (!valeur) return null;
  let cle = String(valeur).trim();
  if (cle.startsWith('prive:')) {
    cle = cle.slice('prive:'.length);
  } else if (/^https?:\/\//.test(cle)) {
    const base = urlPublique();
    if (!base || !cle.startsWith(`${base}/`)) return null;
    cle = cle.slice(base.length + 1);
  }
  cle = cle.replace(/^\/+/, '');
  if (!cle || cle.includes('..')) return null;
  return cle;
}

// ── Écriture ──────────────────────────────────────────────────────────────────

/**
 * Envoie un contenu sur R2 et renvoie la clé écrite.
 * @param {Buffer} buffer
 * @param {string} cle      ex. « produits/2026/11/1763...-ab12….jpg »
 * @param {{ prive?: boolean, type?: string }} [options]
 */
async function envoyer(buffer, cle, { prive = false, type } = {}) {
  await requireClient().send(new PutObjectCommand({
    Bucket: bucket(prive),
    Key: cle,
    Body: buffer,
    ContentType: type || contentType(cle),
    // Les noms sont aléatoires et jamais réécrits : un fichier publié ne
    // change pas, le CDN et les téléphones peuvent le garder un an.
    ...(prive ? {} : { CacheControl: 'public, max-age=31536000, immutable' }),
  }));
  return cle;
}

/** Adresse publique d'une clé du bucket public. */
function adressePublique(cle) {
  return `${urlPublique()}/${cle}`;
}

// ── Lecture privée ────────────────────────────────────────────────────────────

/**
 * Lien signé temporaire vers un objet du bucket privé.
 * @param {string} valeur  clé ou valeur « prive:… » stockée en base
 * @param {number} [secondes] validité (défaut 10 minutes)
 */
async function lienSigne(valeur, secondes = 600) {
  const cle = versCle(valeur);
  if (!cle) throw new Error('Clé R2 invalide');
  return getSignedUrl(
    requireClient(),
    new GetObjectCommand({ Bucket: bucket(true), Key: cle }),
    { expiresIn: secondes },
  );
}

// ── Suppression ───────────────────────────────────────────────────────────────

/** Supprime un objet. Best-effort : n'échoue jamais l'action métier. */
async function supprimer(valeur, { prive = false } = {}) {
  const cle = versCle(valeur);
  if (!cle) return false;
  try {
    await requireClient().send(new DeleteObjectCommand({ Bucket: bucket(prive), Key: cle }));
    return true;
  } catch (err) {
    logger.warn(`[r2] Suppression impossible (${cle}) : ${err.message}`);
    return false;
  }
}

/**
 * Sonde légère (identifiants ET réseau, sans transfert) : HeadBucket sur le
 * bucket public. Réservée aux diagnostics ; /health n'appelle pas le réseau.
 */
async function ping() {
  if (!publicConfigure()) return { configure: false, joignable: null };
  try {
    await getClient().send(new HeadBucketCommand({ Bucket: bucket(false) }));
    return { configure: true, joignable: true };
  } catch (err) {
    logger.warn('[r2] Sonde de disponibilité en échec', { error: err.message });
    return { configure: true, joignable: false, erreur: err.message };
  }
}

module.exports = {
  publicConfigure,
  priveConfigure,
  urlPublique,
  adressePublique,
  envoyer,
  lienSigne,
  supprimer,
  versCle,
  contentType,
  ping,
};
