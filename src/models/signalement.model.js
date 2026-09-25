const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Signalement = sequelize.define('Signalement', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  type: {
    type: DataTypes.ENUM('produit', 'boutique'),
    allowNull: false,
  },
  raison: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  statut: {
    type: DataTypes.ENUM('en_attente', 'traite', 'rejete'),
    defaultValue: 'en_attente',
  },
  signaleurId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'utilisateur',
      key: 'id',
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
  },
  cibleId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
}, {
  tableName: 'signalement',
  freezeTableName: true,
  indexes: [
    // Jointure fréquente : sans index, PostgreSQL parcourt la table entière.
    { fields: ['cible_id'] },
    // Jointure fréquente : sans index, PostgreSQL parcourt la table entière.
    { fields: ['signaleur_id'] },
  ],
  timestamps: true,
  underscored: true,
});

module.exports = Signalement;
