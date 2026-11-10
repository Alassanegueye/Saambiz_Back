const crypto = require('crypto');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { UnauthorizedError, BadRequestError } = require('../errors/AppError');

/**
 * Vérification des jetons d'identité Google et Apple (« Se connecter avec… »).
 *
 * L'application mobile obtient un `idToken` (un JWT signé par Google ou par
 * Apple) et le transmet tel quel. On ne croit rien de ce qu'elle dit d'autre :
 * l'adresse e-mail est lue DANS le jeton, après vérification de sa signature
 * avec les clés publiques du fournisseur, de son émetteur, de son
 * destinataire (notre identifiant d'application) et de sa date d'expiration.
 *
 * Aucune dépendance supplémentaire : les clés publiées (JWKS) sont converties
 * par `crypto.createPublicKey` et vérifiées par `jsonwebtoken`, déjà présent.
 *
 * Configuration (.env) :
 *   GOOGLE_CLIENT_IDS  identifiants OAuth acceptés, séparés par des virgules
 *                      (client iOS, client Web/serveur utilisé par Android)
 *   APPLE_CLIENT_IDS   identifiants Apple acceptés (par défaut le bundle iOS
 *                      `com.saambiz.app`)
 */

const FOURNISSEURS = {
  google: {
    jwks: 'https://www.googleapis.com/oauth2/v3/certs',
    emetteurs: ['https://accounts.google.com', 'accounts.google.com'],
    destinataires: () => liste(process.env.GOOGLE_CLIENT_IDS),
  },
  apple: {
    jwks: 'https://appleid.apple.com/auth/keys',
    emetteurs: ['https://appleid.apple.com'],
    destinataires: () => liste(process.env.APPLE_CLIENT_IDS || 'com.saambiz.app'),
  },
};

function liste(valeur) {
  return String(valeur || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

// Clés publiques en cache : les fournisseurs les changent rarement. Une clé
// inconnue (rotation) force un rechargement, au plus une fois par minute.
const cache = new Map(); // fournisseur → { cles: Map<kid, KeyObject>, chargeLe }
const DUREE_CACHE = 6 * 60 * 60 * 1000;
const DELAI_MIN_RECHARGEMENT = 60 * 1000;

async function chargerCles(nom) {
  const { data } = await axios.get(FOURNISSEURS[nom].jwks, { timeout: 8000 });
  const cles = new Map();
  for (const jwk of data.keys || []) {
    try {
      cles.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' }));
    } catch {
      /* clé d'un type non géré : ignorée */
    }
  }
  const entree = { cles, chargeLe: Date.now() };
  cache.set(nom, entree);
  return entree;
}

async function cle(nom, kid) {
  let entree = cache.get(nom);
  if (!entree || Date.now() - entree.chargeLe > DUREE_CACHE) {
    entree = await chargerCles(nom);
  }
  if (!entree.cles.has(kid) && Date.now() - entree.chargeLe > DELAI_MIN_RECHARGEMENT) {
    entree = await chargerCles(nom);
  }
  return entree.cles.get(kid) || null;
}

const REFUS = 'Connexion refusée : identité non vérifiée.';

/**
 * Vérifie un jeton d'identité et renvoie l'identité qu'il prouve.
 *
 * @param {'google'|'apple'} fournisseur
 * @param {string} idToken
 * @param {{ nonce?: string }} options  nonce brut envoyé par l'application
 *        (Apple) : le jeton porte son empreinte SHA-256, ce qui empêche de
 *        rejouer un jeton intercepté.
 * @returns {Promise<{ sujet: string, email: string, prenom?: string, nom?: string }>}
 */
async function verifier(fournisseur, idToken, { nonce } = {}) {
  const conf = FOURNISSEURS[fournisseur];
  if (!conf) throw new BadRequestError('Fournisseur de connexion inconnu');

  const destinataires = conf.destinataires();
  if (destinataires.length === 0) {
    // Fournisseur non configuré sur ce serveur : on refuse plutôt que
    // d'accepter un jeton émis pour n'importe quelle application.
    throw new BadRequestError(`La connexion ${fournisseur} n'est pas activée.`);
  }

  const entete = jwt.decode(idToken, { complete: true })?.header;
  if (!entete?.kid) throw new UnauthorizedError(REFUS);

  const clePublique = await cle(fournisseur, entete.kid);
  if (!clePublique) throw new UnauthorizedError(REFUS);

  let charge;
  try {
    charge = jwt.verify(idToken, clePublique, {
      algorithms: ['RS256'],
      issuer: conf.emetteurs,
      audience: destinataires,
    });
  } catch {
    throw new UnauthorizedError(REFUS);
  }

  if (fournisseur === 'apple') {
    // Le nonce est EXIGÉ, pas seulement vérifié s'il est présent : l'absence
    // de nonce dans le jeton était auparavant acceptée en silence, ce qui
    // rendait la protection contre le rejeu contournable par un jeton émis
    // sans nonce. L'application en envoie toujours un.
    const attendu = crypto.createHash('sha256').update(String(nonce || '')).digest('hex');
    if (!nonce || !charge.nonce || charge.nonce !== attendu) {
      throw new UnauthorizedError(REFUS);
    }
  }

  // Seule une adresse confirmée par le fournisseur peut ouvrir un compte
  // existant : sinon n'importe qui pourrait déclarer l'adresse d'un autre.
  const emailVerifie = charge.email_verified === true || charge.email_verified === 'true';
  if (!charge.email || !emailVerifie) {
    throw new UnauthorizedError('Votre adresse e-mail n\'est pas vérifiée par ce compte.');
  }

  return {
    sujet: String(charge.sub),
    email: String(charge.email).trim().toLowerCase(),
    prenom: charge.given_name || undefined,
    nom: charge.family_name || undefined,
  };
}

module.exports = { verifier, _cache: cache };
