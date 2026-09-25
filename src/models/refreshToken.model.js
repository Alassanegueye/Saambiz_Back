const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * Jetons de rafraîchissement, stockés hashés.
 *
 * Sans cette table, un refresh signé pour sept jours restait valable sept
 * jours quoi qu'il arrive : pas de révocation à la déconnexion, pas de
 * plafond de sessions, aucun moyen de couper l'accès d'un appareil perdu.
 *
 * Le jeton lui-même n'est jamais écrit en base, seulement son SHA-256 : une
 * fuite de la table ne donne donc aucune session utilisable. Le SHA-256 suffit
 * ici, contrairement aux mots de passe — un refresh est déjà une valeur
 * aléatoire de haute entropie, il n'y a rien à deviner par force brute.
 */
const RefreshToken = sequelize.define('RefreshToken', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  utilisateurId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'utilisateur_id',
  },
  tokenHash: {
    type: DataTypes.STRING(64),
    allowNull: false,
    field: 'token_hash',
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: false,
    field: 'expires_at',
  },
  // Date de révocation. On garde la ligne au lieu de la supprimer : savoir
  // qu'une session a été révoquée, et quand, sert aux enquêtes.
  revokedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'revoked_at',
  },
  // Contexte de création, utile pour présenter « vos appareils connectés ».
  userAgent: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'user_agent',
  },
  adresseIp: {
    type: DataTypes.STRING(64),
    allowNull: true,
    field: 'adresse_ip',
  },
}, {
  tableName: 'refresh_token',
  freezeTableName: true,
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['token_hash'] },      // recherche à chaque rafraîchissement
    { fields: ['utilisateur_id'] },  // plafond de sessions et révocation en masse
    { fields: ['expires_at'] },      // purge par le cron
  ],
});

module.exports = RefreshToken;
