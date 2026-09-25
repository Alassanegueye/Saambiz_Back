const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * Vérification d'adresse en cours, AVANT que le compte n'existe.
 *
 * Distincte de `user_otp`, qui exige un `utilisateurId` : ici, l'utilisateur
 * n'est précisément pas encore créé. La ligne est éphémère — elle disparaît à
 * l'inscription, ou expire.
 */
const VerificationEmail = sequelize.define('VerificationEmail', {
  // Une seule vérification en cours par adresse : redemander un code remplace
  // le précédent, il n'y a jamais deux codes valides à la fois.
  email: {
    type: DataTypes.STRING(255),
    primaryKey: true,
    allowNull: false,
  },

  // Le code n'est jamais stocké en clair : il tient en six chiffres, et une
  // copie de la base suffirait sinon à valider n'importe quelle adresse.
  codeHash: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: false,
  },

  // Plafond d'essais : six chiffres se devinent en un million de coups, ce qui
  // est peu pour une machine.
  tentatives: {
    type: DataTypes.SMALLINT,
    allowNull: false,
    defaultValue: 0,
  },

  // Remis à l'application une fois le code validé, réclamé par `register`.
  // Il lie la création du compte à CETTE vérification-là.
  jetonHash: {
    type: DataTypes.STRING(64),
    allowNull: true,
  },
  jetonExpireLe: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'verification_email',
  freezeTableName: true,
  timestamps: true,
  underscored: true,
});

module.exports = VerificationEmail;
