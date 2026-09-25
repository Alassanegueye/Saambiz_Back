// models/ligneCommande.model.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const LigneCommande = sequelize.define('LigneCommande', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },

  commandeId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'commande', key: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
  },

  produitId: {
    type: DataTypes.UUID,
    allowNull: true, // produit peut être supprimé plus tard → on garde le snapshot
    references: { model: 'produit', key: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
  },

  // Snapshots figés au moment de la commande (le produit peut changer/disparaître)
  nomProduit: {
    type: DataTypes.STRING,
    allowNull: false,
  },

  imageProduit: {
    type: DataTypes.TEXT,
    allowNull: true,
  },

  prixUnitaire: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
  },

  quantite: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: { min: 1 },
  },

  sousTotal: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
  },

}, {
  tableName: 'ligne_commande',
  freezeTableName: true,
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['commande_id'] },
    { fields: ['produit_id'] },
  ],
});

module.exports = LigneCommande;
