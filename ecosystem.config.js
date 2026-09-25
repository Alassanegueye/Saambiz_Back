'use strict';

const path = require('path');

module.exports = {
  apps: [
    {
      name: 'saambiz-backend',
      script: path.join(__dirname, 'src', 'server.js'),

      // ⚠️ IMPORTANT — Socket.IO (messagerie/notifications temps réel) :
      // ce projet n'utilise PAS d'adaptateur Redis pour Socket.IO. En mode
      // cluster (plusieurs instances), deux utilisateurs connectés à des
      // workers différents ne peuvent PAS communiquer entre eux (rooms
      // en mémoire, non partagées entre process). Tant qu'un adaptateur
      // Redis (@socket.io/redis-adapter) n'est pas ajouté, garder
      // PM2_INSTANCES=1 en production (ou utiliser Docker Compose, qui ne
      // lance qu'une seule instance par défaut).
      instances: process.env.PM2_INSTANCES || 1,
      exec_mode: process.env.PM2_INSTANCES && process.env.PM2_INSTANCES !== '1'
        ? 'cluster'
        : 'fork',

      // Variables d'env injectées par PM2 (complète le .env déjà chargé par dotenv)
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },

      // Logs PM2 (séparés des logs applicatifs Winston, qui écrivent sur stdout)
      error_file: path.join(__dirname, 'logs', 'pm2-error.log'),
      out_file: path.join(__dirname, 'logs', 'pm2-out.log'),
      log_file: path.join(__dirname, 'logs', 'pm2-combined.log'),
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // Redémarrage automatique si la RAM dépasse 500 MB
      max_memory_restart: '500M',

      // Délai entre 2 redémarrages automatiques
      restart_delay: 3000,

      // Nombre max de redémarrages avant que PM2 abandonne
      max_restarts: 10,
      min_uptime: '10s',

      // Ne pas surveiller les fichiers (les changements se font via git + pm2 reload)
      watch: false,

      // Arrêt propre : PM2 attend SIGTERM + drain des connexions en cours
      // (le serveur gère déjà SIGTERM/SIGINT proprement dans src/server.js)
      kill_timeout: 10000,
      listen_timeout: 8000,
      shutdown_with_message: false,
    },
  ],
};
