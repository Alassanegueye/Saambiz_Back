require('dotenv').config();
const { ipKeyGenerator } = require('express-rate-limit');

// ═══════════════════════════════════════════════════════════════════════════
//  Source unique de la configuration de sécurité.
//
//  Tout ce qui suit est validé au chargement du module, donc avant qu'Express
//  n'écoute. Le principe : échouer au démarrage vaut mieux qu'une faille
//  silencieuse. Une API qui refuse de partir se voit tout de suite ; une API
//  qui accepte n'importe quelle origine se voit six mois plus tard.
// ═══════════════════════════════════════════════════════════════════════════

const EN_PRODUCTION = process.env.NODE_ENV === 'production';

/** Interrompt le démarrage avec un message qui dit quoi corriger. */
function refuserDemarrage(raison) {
  throw new Error(`[SECURITY] ${raison} — démarrage bloqué.`);
}

// ─── Secrets JWT ───────────────────────────────────────────────────────────
// Trois usages, trois secrets. Un secret partagé entre l'accès et le
// rafraîchissement annule la séparation : un jeton d'accès volé deviendrait
// utilisable pour se prolonger indéfiniment.
const _accessSecret  = process.env.JWT_SECRET;
const _refreshSecret = process.env.JWT_REFRESH_SECRET;
// Le secret de réinitialisation est facultatif en développement pour ne pas
// casser les environnements existants ; il est exigé en production.
const _resetSecret   = process.env.JWT_RESET_SECRET;

const _secrets = {
  JWT_SECRET: _accessSecret,
  JWT_REFRESH_SECRET: _refreshSecret,
  ...(EN_PRODUCTION || _resetSecret ? { JWT_RESET_SECRET: _resetSecret } : {}),
};

for (const [nom, valeur] of Object.entries(_secrets)) {
  if (!valeur || valeur.length < 32) {
    refuserDemarrage(`${nom} manquant ou inférieur à 32 caractères`);
  }
}

// Deux secrets identiques ne protègent pas plus qu'un seul.
const _valeurs = Object.values(_secrets);
if (new Set(_valeurs).size !== _valeurs.length) {
  refuserDemarrage('Deux secrets JWT portent la même valeur');
}

// Valeurs d'exemple : elles traînent dans les .env copiés depuis .env.example
// et sont publiques par construction.
const _MOTIFS_EXEMPLE = ['change_me', 'changeme', 'dev_jwt', 'exemple', 'example', 'secret_a_changer'];
if (EN_PRODUCTION) {
  for (const [nom, valeur] of Object.entries(_secrets)) {
    if (_MOTIFS_EXEMPLE.some((m) => valeur.toLowerCase().includes(m))) {
      refuserDemarrage(`${nom} contient une valeur d'exemple`);
    }
  }
}

const jwtConfig = {
  secret: _accessSecret,
  expiresIn: process.env.JWT_EXPIRES_IN || '1h',
  refreshSecret: _refreshSecret,
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  // Repli sur le secret d'accès en développement uniquement : en production
  // la boucle ci-dessus a déjà exigé une valeur distincte.
  resetSecret: _resetSecret || _accessSecret,
  resetExpiresIn: process.env.JWT_RESET_EXPIRES_IN || '1h',
};

// Nombre maximal de sessions simultanées par compte. Au-delà, la plus
// ancienne est révoquée — un jeton volé ne survit donc pas indéfiniment à
// côté des sessions légitimes.
const refreshTokenConfig = {
  maxParUtilisateur: Number(process.env.REFRESH_MAX_PAR_UTILISATEUR) || 5,
  dureeJours: Number(process.env.REFRESH_DUREE_JOURS) || 7,
};

// ─── Mots de passe ─────────────────────────────────────────────────────────
const bcryptConfig = { saltRounds: 12 };

const passwordPolicy = {
  minLength: 8,
  requireUppercase: true,
  requireNumber: true,
  requireSpecialChar: true,
};

// ─── Limitation de débit ───────────────────────────────────────────────────
// Désactivée hors production : un dashboard en développement fait beaucoup de
// requêtes, doublées par React StrictMode.
//
// Le garde-fou qui suit existe parce que toute la défense anti-brute-force
// tient à cette seule variable : sur un environnement de recette exposé où
// NODE_ENV n'est pas positionné, l'API tournerait sans aucune limite. On
// exige alors un aveu explicite.
const _limitesDesactivees = !EN_PRODUCTION;
if (_limitesDesactivees && process.env.EXPOSE_PUBLIQUEMENT === 'true') {
  refuserDemarrage(
    'Limitation de débit désactivée (NODE_ENV ≠ production) sur une instance '
    + 'déclarée publique. Positionnez NODE_ENV=production'
  );
}

const _sauterEnDev = () => _limitesDesactivees;

/**
 * Clé de comptage : l'utilisateur authentifié, sinon l'IP.
 *
 * Sans cette clé, plusieurs comptes derrière une même sortie internet — un
 * cybercafé, une boutique — se bloquent mutuellement.
 *
 * `ipKeyGenerator` normalise les adresses IPv6 sur leur préfixe /64 : sans
 * lui, un même abonné dispose de milliards d'adresses et contourne la limite
 * en changeant d'adresse à chaque requête.
 */
function cleParUtilisateur(req) {
  return req.user?.id ? `u:${req.user.id}` : `ip:${ipKeyGenerator(req.ip)}`;
}

const rateLimitConfig = {
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX) || 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: _sauterEnDev,
  message: { success: false, message: 'Trop de requêtes, veuillez réessayer dans 15 minutes.' },
};

const authRateLimitConfig = {
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: _sauterEnDev,
  message: { success: false, message: 'Trop de tentatives, veuillez réessayer dans 15 minutes.' },
};

// Requêtes authentifiées : comptées par compte, pas par IP.
const userRateLimitConfig = {
  windowMs: 60 * 1000,
  max: Number(process.env.USER_RATE_LIMIT_MAX) || 120,
  standardHeaders: true,
  legacyHeaders: false,
  skip: _sauterEnDev,
  keyGenerator: cleParUtilisateur,
  message: { success: false, message: 'Trop de requêtes sur ce compte, patientez une minute.' },
};

// Mutations sensibles (création de commande, paiement, envoi en masse).
const mutationRateLimitConfig = {
  windowMs: 60 * 1000,
  max: Number(process.env.MUTATION_RATE_LIMIT_MAX) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: _sauterEnDev,
  keyGenerator: cleParUtilisateur,
  message: { success: false, message: 'Trop d\'opérations, patientez une minute.' },
};

// Envoi de code à usage unique : compté sur l'adresse VISÉE, pas sur l'IP de
// l'appelant. Sinon un attaquant qui fait tourner ses adresses IP pilonne la
// boîte mail d'une victime sans jamais déclencher la limite.
const otpRateLimitConfig = {
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.OTP_RATE_LIMIT_MAX) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: _sauterEnDev,
  keyGenerator: (req) => {
    const email = (req.body?.email || req.body?.identifiant || '').toLowerCase().trim();
    return email ? `otp:${email}` : `otp-ip:${ipKeyGenerator(req.ip)}`;
  },
  message: { success: false, message: 'Trop de codes demandés pour cette adresse, réessayez dans 15 minutes.' },
};

// ─── CORS ──────────────────────────────────────────────────────────────────
const _originesBrutes = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

if (EN_PRODUCTION) {
  if (_originesBrutes.length === 0) {
    refuserDemarrage('CORS_ORIGIN doit lister explicitement les origines autorisées en production');
  }
  if (_originesBrutes.includes('*')) {
    refuserDemarrage('CORS_ORIGIN ne peut pas valoir "*" en production');
  }
  const _local = _originesBrutes.find((o) => /localhost|127\.0\.0\.1/.test(o));
  if (_local) {
    refuserDemarrage(`CORS_ORIGIN contient une origine de développement (${_local}) en production`);
  }
}

const _originesAutorisees = _originesBrutes.length ? _originesBrutes : ['http://localhost:3000'];

/** Une origine de la machine de développement, quel que soit son port. */
const _estOrigineLocale = (origine) =>
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origine);

const corsConfig = {
  /**
   * En production, la liste `CORS_ORIGIN` fait loi — les gardes ci-dessus
   * refusent d'ailleurs le démarrage si elle est vide, jokerisée, ou remplie
   * d'adresses locales.
   *
   * En développement, toute origine locale est acceptée quel que soit son
   * port. Sans cela, Flutter Web est inutilisable : son serveur de débogage
   * tire un port au hasard à chaque lancement, et l'application échoue sur un
   * « XMLHttpRequest error » que rien n'explique — le navigateur masque le
   * refus CORS derrière une erreur réseau générique. Ajouter le port à la
   * main dans `.env` après chaque redémarrage ne tient pas.
   */
  origin(origine, retour) {
    // Pas d'origine : appel serveur à serveur, curl, ou application mobile
    // native. Un navigateur en envoie toujours une.
    if (!origine) return retour(null, true);
    if (_originesAutorisees.includes(origine)) return retour(null, true);
    if (!EN_PRODUCTION && _estOrigineLocale(origine)) return retour(null, true);
    return retour(new Error(`Origine non autorisée : ${origine}`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  credentials: true,
};

const cookieConfig = {
  httpOnly: true,
  secure: EN_PRODUCTION,
  sameSite: 'strict',
};

const uploadConfig = {
  maxFileSize: 5 * 1024 * 1024,
  allowedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg'],
};

const cryptoConfig = {
  hashAlgorithm: 'sha256',
  encoding: 'hex',
};

module.exports = {
  jwtConfig,
  refreshTokenConfig,
  bcryptConfig,
  passwordPolicy,
  rateLimitConfig,
  authRateLimitConfig,
  userRateLimitConfig,
  mutationRateLimitConfig,
  otpRateLimitConfig,
  corsConfig,
  cookieConfig,
  uploadConfig,
  cryptoConfig,
};
