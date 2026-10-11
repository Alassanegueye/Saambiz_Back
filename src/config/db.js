require('dotenv').config();
const { Sequelize } = require('sequelize');

// SSL exigé par tous les PostgreSQL managés (Render, Railway, Neon…).
// `rejectUnauthorized: false` parce que ces hébergeurs signent avec leur
// propre autorité : sans ça, la connexion échoue sur « self signed
// certificate in certificate chain » alors que le chiffrement fonctionne.
const EN_PRODUCTION = process.env.NODE_ENV === 'production';
const dialectOptions = {
  ssl: EN_PRODUCTION ? { require: true, rejectUnauthorized: false } : false,
};

const options = {
  dialect: 'postgres',
  logging: false,
  dialectOptions,
  // Pool réglable par l'environnement (standard SIGN). La bonne taille
  // dépend de l'hébergement : une base Render « starter » accepte peu de
  // connexions, et chaque worker PM2 ouvre son propre pool — 4 workers × 10
  // connexions saturent vite une petite instance. Défauts inchangés.
  pool: {
    max: Number(process.env.DB_POOL_MAX) || 10,
    min: Number(process.env.DB_POOL_MIN) || 0,
    acquire: Number(process.env.DB_POOL_ACQUIRE_MS) || 30000,
    idle: Number(process.env.DB_POOL_IDLE_MS) || 10000,
  },
  define: { freezeTableName: true },
};

// Deux façons de décrire la base, dans cet ordre de priorité :
//
//   1. DATABASE_URL — une seule chaîne. C'est ce que fournissent Render et la
//      plupart des hébergeurs managés ; recopier à la main cinq valeurs depuis
//      leur tableau de bord est le meilleur moyen d'en fausser une et de
//      chercher longtemps pourquoi la connexion est refusée.
//
//   2. DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD — le mode
//      historique, utilisé par docker-compose et le développement local.
//
// DB_PORT était documenté dans .env.example mais n'était passé nulle part :
// Sequelize retombait silencieusement sur 5432. Une base exposée sur un autre
// port échouait donc sans que le réglage prévu pour ça ait le moindre effet.
const urlFournie = (process.env.DATABASE_URL || '').trim();
const hoteFourni = (process.env.DB_HOST || '').trim();

// Sans aucune des deux, Sequelize vise silencieusement `localhost` et la
// connexion est refusée — sur un hébergeur, aucun PostgreSQL n'y écoute. On
// obtient alors un `SequelizeConnectionRefusedError` nu, qui ne dit ni quelle
// adresse a été tentée ni quelle variable manque, et l'on cherche du côté du
// réseau ou du mot de passe pendant que la cause est une variable vide.
if (EN_PRODUCTION && !urlFournie && !hoteFourni) {
  throw new Error(
    '[DB] Ni DATABASE_URL ni DB_HOST ne sont définis en production. '
    + "Sans eux la connexion viserait localhost, où rien n'écoute. "
    + "Renseignez DATABASE_URL avec l'adresse interne de votre base "
    + '(Render, Railway, Neon…).',
  );
}

// Un hôte local en production est toujours une erreur de configuration : chez
// un hébergeur managé, la base est un service distinct, joignable par son
// adresse interne. `localhost` y désigne le conteneur applicatif lui-même, où
// aucun PostgreSQL ne tourne.
//
// Le cas vient de la recopie du .env de développement dans le tableau de bord
// de l'hébergeur : DB_HOST=localhost passait le contrôle ci-dessus — il n'est
// pas vide — et l'on obtenait un refus de connexion sans rapport apparent avec
// une variable mal réglée. Même logique que CORS_ORIGIN, qui refuse déjà une
// origine locale en production.
const _hoteEffectif = urlFournie
  ? (() => { try { return new URL(urlFournie).hostname; } catch { return ''; } })()
  : hoteFourni;

if (EN_PRODUCTION && /^(localhost|127\.0\.0\.1|::1|\[::1\])$/.test(_hoteEffectif)) {
  throw new Error(
    `[DB] La base est déclarée sur « ${_hoteEffectif} » en production. `
    + "Chez un hébergeur, localhost désigne le conteneur de l'application, "
    + 'où aucun PostgreSQL ne tourne. Supprimez DB_HOST / DB_PORT / DB_NAME / '
    + "DB_USER / DB_PASSWORD et renseignez DATABASE_URL avec l'adresse interne "
    + 'de votre base.',
  );
}

const sequelize = urlFournie
  ? new Sequelize(urlFournie, options)
  : new Sequelize(
      process.env.DB_NAME,
      process.env.DB_USER,
      process.env.DB_PASSWORD,
      {
        ...options,
        host: hoteFourni || undefined,
        port: Number(process.env.DB_PORT) || 5432,
      },
    );

/** Hôte et base visés, sans identifiants — pour les journaux de démarrage. */
sequelize.cible = (() => {
  try {
    if (urlFournie) {
      const u = new URL(urlFournie);
      return `${u.hostname}:${u.port || 5432}/${u.pathname.replace(/^\//, '')}`;
    }
  } catch { /* URL illisible : on retombe sur la description ci-dessous */ }
  const hote = hoteFourni || 'localhost (aucun DB_HOST défini)';
  return `${hote}:${Number(process.env.DB_PORT) || 5432}/${process.env.DB_NAME || '(DB_NAME vide)'}`;
})();

module.exports = sequelize;
