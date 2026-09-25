// models/auditLog.model.js
// Table entièrement nouvelle : journal d'audit des actions administrateur
const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const AuditLog = sequelize.define('AuditLog', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  adminId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'utilisateur',
      key: 'id'
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE'
  },
  action: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  cible: {
    type: DataTypes.STRING,
    allowNull: false, // ex: 'vendeur', 'produit', 'boutique', 'signalement', 'config', 'abonnement'
  },
  cibleId: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  details: {
    type: DataTypes.JSON,
    allowNull: true,
  },
}, {
  tableName: 'audit_log',
  freezeTableName: true,
  timestamps: true,
  updatedAt: false,
  underscored: true,
  indexes: [
    { fields: ['admin_id'] },
    // Jointure fréquente : sans index, PostgreSQL parcourt la table entière.
    { fields: ['cible_id'] },
    { fields: ['action'] },
    { fields: ['cible'] },
  ]
});

module.exports = AuditLog;
