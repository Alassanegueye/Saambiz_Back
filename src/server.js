require('dotenv').config();
const http = require('http');
const sequelize = require('./config/db');
const app = require('./app');
const logger = require('./utils/logger');
const { initSocket } = require('./services/socket.service');
const startJobs = require('./jobs');

// Charger toutes les associations de modèles
require('./models/index');

// Imports explicites pour s'assurer que Sequelize crée toutes les tables
require('./models/utilisateur.model');
require('./models/boutique.model');
require('./models/produit.model');
require('./models/categorie.model');
require('./models/abonnement.model');
require('./models/paiement.model');
require('./models/userOtp.model');
require('./models/favori.model');
require('./models/message.model');
require('./models/promotion.model');
require('./models/notification.model');
require('./models/signalement.model');
require('./models/tokenBlacklist.model');
require('./models/configApp.model');
require('./models/produitImage.model');
require('./models/demandeRetour.model');
require('./models/auditLog.model');
require('./models/avis.model');

const PORT = process.env.PORT || 3000;
// MED-06 : adresse bind configurable via env (127.0.0.1 derrière un proxy, 0.0.0.0 en direct)
const HOST = process.env.HOST || '0.0.0.0';

(async () => {
  try {
    // En production : ne jamais altérer le schéma au démarrage — utiliser des migrations.
    // En développement : on utilise sync() simple (création des tables manquantes).
    //   NB : on n'utilise PAS { alter: true } car il génère un SQL invalide sur PostgreSQL
    //   pour les colonnes `unique` (erreur "syntax error at or near UNIQUE", bug Sequelize 6).
    //   Pour faire évoluer un schéma existant, passez par une migration ou recréez la base de dev.
    const isProd = process.env.NODE_ENV === 'production';
    await sequelize.sync({ force: false });
    logger.info(
      isProd
        ? 'DB connectée (mode production — schéma non altéré)'
        : 'DB synchronisée (création des tables manquantes)'
    );

    // Serveur HTTP explicite (au lieu de app.listen) pour pouvoir brancher Socket.IO dessus
    const httpServer = http.createServer(app);
    initSocket(httpServer);

    // Les taches planifiees appartiennent au processus serveur, pas au module
    // HTTP : importer `app` pour un test ou un script ne doit pas lancer de cron.
    startJobs();

    const server = httpServer.listen(PORT, HOST, () => {
      logger.info(`Serveur démarré sur ${HOST}:${PORT} [${process.env.NODE_ENV || 'development'}]`);
    });

    // Résilience : graceful shutdown sur SIGTERM et SIGINT
    const shutdown = (signal) => {
      logger.info(`Signal ${signal} reçu — arrêt en cours…`);
      server.close(async () => {
        try {
          await sequelize.close();
          logger.info('Connexion DB fermée proprement');
        } catch (_) { /* ignore */ }
        process.exit(0);
      });
      // Forcer l'arrêt après 10s si le serveur ne se ferme pas
      setTimeout(() => {
        logger.error('Arrêt forcé après timeout de 10s');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));

    // ── Filets de sécurité ────────────────────────────────────────────────
    // Sans eux, Node coupe le processus sans rien écrire dans winston : on
    // constate le redémarrage sans jamais savoir pourquoi.
    //
    // Dans les deux cas on quitte volontairement : après une exception non
    // interceptée, l'état du processus n'est plus garanti, et continuer à
    // servir avec un état douteux fait plus de dégâts qu'un redémarrage. Le
    // superviseur (Docker `restart: unless-stopped`, ou PM2) relance.
    process.on('uncaughtException', (err) => {
      logger.error('exception_non_interceptee', {
        message: err.message,
        name: err.name,
        stack: err.stack,
      });
      shutdown('uncaughtException');
    });

    process.on('unhandledRejection', (raison) => {
      logger.error('rejet_non_gere', {
        message: raison instanceof Error ? raison.message : String(raison),
        stack: raison instanceof Error ? raison.stack : undefined,
      });
      shutdown('unhandledRejection');
    });

  } catch (err) {
    logger.error('Erreur lors du démarrage', { message: err.message, stack: err.stack });
    process.exit(1);
  }
})();
