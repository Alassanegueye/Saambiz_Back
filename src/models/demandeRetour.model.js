// models/demandeRetour.model.js
// Table entièrement nouvelle : workflow de retour / remboursement d'une commande livrée
const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const DemandeRetour = sequelize.define('DemandeRetour', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  commandeId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'commande',
      key: 'id'
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE'
  },
  acheteurId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'utilisateur',
      key: 'id'
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE'
  },
  raison: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  statut: {
    type: DataTypes.ENUM('en_attente', 'acceptee', 'refusee'),
    allowNull: false,
    defaultValue: 'en_attente',
  },
  reponseAdmin: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
}, {
  tableName: 'demande_retour',
  freezeTableName: true,
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['commande_id'] },
    { fields: ['acheteur_id'] },
    { fields: ['statut'] },
  ]
});

module.exports = DemandeRetour;
