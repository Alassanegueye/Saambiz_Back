const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression'); // PERF-01 : compression gzip
const rateLimit = require('express-rate-limit');
const { randomUUID } = require('crypto');
const { corsConfig, rateLimitConfig, authRateLimitConfig, userRateLimitConfig } = require('./config/security');
const logger = require('./utils/logger');

const app = express();

// F-02 : Helmet avec CSP personnalisée + HSTS explicite
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],   // requis pour Swagger UI en dev
      styleSrc:  ["'self'", "'unsafe-inline'"],
      imgSrc:    ["'self'", 'data:', 'https://res.cloudinary.com'],
      connectSrc:["'self'"],
      fontSrc:   ["'self'"],
      objectSrc: ["'none'"],
      frameSrc:  ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,        // 1 an
    includeSubDomains: true,
    preload: true,
  },
}));
app.use(cors(corsConfig));

// Pictogramme des emails (en-tête des templates/mail) : servi publiquement,
// avant le limiteur de requêtes. Helmet pose « Cross-Origin-Resource-Policy:
// same-origin », qui empêcherait les webmails de l'afficher : on l'ouvre ici.
app.use(
  '/email',
  express.static(require('path').join(__dirname, '..', 'public', 'email'), {
    maxAge: '7d',
    setHeaders: (res) => res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
  })
);

// LOW-03 : X-Request-ID pour le tracing distribué
app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] || randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  next();
});

// Compatibilité : les applications déjà déployées (mobile, dashboard) appellent
// encore /jendal. On réécrit l'URL vers le nouveau préfixe /saambiz avant tout
// routage, le temps que leurs API_BASE_URL soient mises à jour.
// À retirer une fois les clients migrés.
app.use((req, _res, next) => {
  if (req.url === '/jendal' || req.url.startsWith('/jendal/')) {
    req.url = '/saambiz' + req.url.slice('/jendal'.length);
  }
  next();
});

// MED-05 : rawBody uniquement sur la route webhook Orange (évite double bufferisation)
app.use('/saambiz/paiement/webhook/orange', (req, res, next) => {
  let data = '';
  req.on('data', chunk => { data += chunk; });
  req.on('end', () => { req.rawBody = data; });
  next();
});

// 512 ko : les fichiers passent par Multer, pas par ce parseur. Une limite
// haute ici n'apporte rien et offre une surface d'épuisement mémoire.
app.use(express.json({ limit: '512kb' }));
app.use(express.urlencoded({ extended: true, limit: '512kb' }));

// PERF-01 : compression gzip/brotli
app.use(compression());

app.use(rateLimit(rateLimitConfig));

// Logger HTTP structuré avec Request ID
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info('http', {
      requestId: req.requestId,
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      ms: Date.now() - start,
      ip: req.ip,
    });
  });
  next();
});

// R-02 : Swagger UI désactivé en production
if (process.env.NODE_ENV !== 'production') {
  const swaggerUi = require('swagger-ui-express');
  const swaggerSpec = require('./config/swagger');
  app.use('/saambiz-api', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}


// Routes
const authRoutes = require('./routes/auth.route');
const vendeurRoutes = require('./routes/vendeurs/vendeur.route');
const acheteursRoutes = require('./routes/acheteurs/acheteurs.route');
const adminRoutes = require('./routes/admin/admin.route');
const paiementRoutes = require('./routes/paiement/paiement.route');
const accountRoutes = require('./routes/account.route');
const favoriRoutes = require('./routes/favoris/favori.route');
const messageRoutes = require('./routes/messagerie/message.route');
const promotionRoutes = require('./routes/promotions/promotion.route');
const notificationRoutes = require('./routes/notifications/notification.route');
const categorieRoutes = require('./routes/categories/categorie.route');
const catalogueRoutes = require('./routes/catalogue/catalogue.route');
const signalementRoutes = require('./routes/signalements/signalement.route');
const deviceTokenRoutes = require('./routes/deviceToken.route');
const adminManagementRoutes = require('./routes/adminManagement.route');
const commandeRoutes = require('./routes/commandes/commande.route');
const avisRoutes = require('./routes/avis/avis.route');
const vitrineRoutes = require('./routes/vitrine/vitrine.route');
const configPubliqueRoutes = require('./routes/config/configPublique.route');


// ═══════════════════════════════════════════════════════════════════════════
//  Routes de l'API — montées sur un routeur unique, exposé à deux adresses.
//
//  `/saambiz/v1/…` est l'adresse de référence. `/saambiz/…` reste servie en
//  alias parce que l'application mobile déjà installée sur les téléphones
//  l'appelle : couper cette adresse déconnecterait tous les utilisateurs qui
//  n'ont pas mis à jour. L'alias ajoute un en-tête `Deprecation`, ce qui
//  permet de mesurer le trafic résiduel avant de le retirer.
// ═══════════════════════════════════════════════════════════════════════════
const apiRouter = express.Router();

// Rate limit renforcé sur les routes d'authentification/OTP
apiRouter.use('/auth', rateLimit(authRateLimitConfig));
apiRouter.use('/auth', authRoutes);

// Le site public d'une boutique — saambiz.com/b/<slug>.
// Monté avant le limiteur par compte : ses visiteurs n'ont pas de compte,
// `cleParUtilisateur` retomberait sur l'IP et une boutique un peu visitée
// depuis une connexion partagée bloquerait ses propres clients. Chaque route
// de la vitrine porte le plafond qui lui convient (voir vitrine.route.js).
apiRouter.use('/vitrine', vitrineRoutes);

// Réglages publics (`/prix-abonnement`, `/app/config`). Montés sur le routeur
// d'API : ils répondent donc aussi sous `/saambiz/v1/…`, alors qu'ils
// n'existaient auparavant que sans version. Les anciennes adresses restent
// servies par l'alias `/saambiz` plus bas.
apiRouter.use('/', configPubliqueRoutes);

// Limiteur par compte pour tout ce qui suit. Le limiteur global compte par IP :
// derrière une sortie internet partagée — un cybercafé, une boutique — les
// comptes se bloquaient mutuellement. Celui-ci compte par utilisateur
// authentifié, et retombe sur l'IP pour les routes ouvertes aux invités.
const limiteParCompte = rateLimit(userRateLimitConfig);

// La gestion RBAC est montée avant `/admin` : sinon `/admin` capterait
// `/admin/rbac/*` avant qu'il n'y arrive.
apiRouter.use('/admin/rbac', limiteParCompte, adminManagementRoutes);
apiRouter.use('/vendeur', limiteParCompte, vendeurRoutes);
apiRouter.use('/acheteurs', limiteParCompte, acheteursRoutes);
apiRouter.use('/admin', limiteParCompte, adminRoutes);
apiRouter.use('/paiement', limiteParCompte, paiementRoutes);
apiRouter.use('/commandes', limiteParCompte, commandeRoutes);
apiRouter.use('/avis', limiteParCompte, avisRoutes);
apiRouter.use('/account', limiteParCompte, accountRoutes);
apiRouter.use('/favoris', limiteParCompte, favoriRoutes);
apiRouter.use('/messages', limiteParCompte, messageRoutes);
apiRouter.use('/promotions', limiteParCompte, promotionRoutes);
apiRouter.use('/notifications', limiteParCompte, notificationRoutes);
apiRouter.use('/categories', limiteParCompte, categorieRoutes);
// Catalogue public (invités compris) : produits, fiche, promotions, boutique.
apiRouter.use('/catalogue', limiteParCompte, catalogueRoutes);
apiRouter.use('/signalements', limiteParCompte, signalementRoutes);
apiRouter.use('/device-token', limiteParCompte, deviceTokenRoutes);

// Adresse de référence
app.use('/saambiz/v1', apiRouter);

// Alias historique, sans version. Le marquage permet de savoir quand plus
// personne ne l'utilise.
app.use('/saambiz', (req, res, next) => {
  res.set('Deprecation', 'true');
  res.set('Link', '</saambiz/v1>; rel="successor-version"');
  next();
}, apiRouter);

// LOW-08 : health check
//
// `commit` porte la révision réellement en cours d'exécution. Render pose
// RENDER_GIT_COMMIT sur chaque service ; ailleurs, GIT_COMMIT fait l'affaire.
//
// Sans ce champ, un déploiement n'est pas vérifiable : sonder /health juste
// après l'avoir déclenché renvoie 200 — mais c'est l'ANCIENNE instance qui
// répond, celle qui tourne encore pendant que la nouvelle se construit. La CI
// passait donc au vert sans avoir rien prouvé, et un build cassé ressemblait
// trait pour trait à un déploiement réussi. Comparer ce champ au SHA poussé
// lève l'ambiguïté.
app.get('/health', async (req, res) => {
  const commit = process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || null;
  try {
    const sequelize = require('./config/db');
    await sequelize.authenticate();
    return res.status(200).json({
      status: 'ok',
      uptime: process.uptime(),
      env: process.env.NODE_ENV,
      commit,
      // Envoi des e-mails : clé Resend présente ? domaine expéditeur ?
      // Diagnostic immédiat quand un utilisateur ne reçoit pas son code.
      email: require('./services/resend.service').etatEmail(),
    });
  } catch {
    // Le commit est renvoyé même en panne de base : c'est précisément quand le
    // service est dégradé qu'on veut savoir quelle version est en ligne.
    return res.status(503).json({ status: 'error', message: 'DB inaccessible', commit });
  }
});

// Gestionnaire d'erreurs global — DERNIER middleware.
// Il traduit AppError, JWT, Multer, JSON malformé, 413 et toutes les erreurs
// Sequelize ; l'ancienne version se contentait de relayer `err.status`, ce qui
// renvoyait un 500 opaque pour un doublon ou un jeton expiré.
const errorHandler = require('./middlewares/errorHandler.middleware');
app.use(errorHandler);

module.exports = app;
