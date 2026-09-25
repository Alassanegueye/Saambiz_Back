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
const sequelize = process.env.DATABASE_URL
  ? new Sequelize(process.env.DATABASE_URL, options)
  : new Sequelize(
      process.env.DB_NAME,
      process.env.DB_USER,
      process.env.DB_PASSWORD,
      {
        ...options,
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 5432,
      },
    );

module.exports = sequelize;
