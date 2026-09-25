// models/produitImage.model.js
// Table entièrement nouvelle : images multiples pour un produit (en plus du champ `image` existant)
const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const ProduitImage = sequelize.define('ProduitImage', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  produitId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'produit',
      key: 'id'
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE'
  },
  url: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  ordre: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
}, {
  tableName: 'produit_image',
  freezeTableName: true,
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['produit_id'] },
  ]
});

module.exports = ProduitImage;
