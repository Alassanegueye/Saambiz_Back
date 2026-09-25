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
  pool: { max: 10, min: 0, acquire: 30000, idle: 10000 },
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
