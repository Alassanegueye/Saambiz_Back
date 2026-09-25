const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');
const User = require('./utilisateur.model');
const Categorie = require('./categorie.model');

const Produit = sequelize.define('Produit', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  nom: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  prix: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
  },
  // Prix barré / promotionnel (facultatif). Si défini et < prix, le produit est en promo.
  prix_promo: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
  },
  quantite: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  image: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  // Marque du produit (facultatif)
  marque: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  // Variantes libres définies par le vendeur : { tailles: [...], couleurs: [...], ... }
  attributs: {
    type: DataTypes.JSONB,
    allowNull: true,
  },
  disponible: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  vues: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  // Nombre de ventes (produits vendus) — pour le tri "meilleures ventes"
  nombre_ventes: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  statut: {
    type: DataTypes.ENUM('en_attente', 'approuve', 'rejete'),
    defaultValue: 'approuve',
  },
  vendeurId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'utilisateur',
      key: 'id'
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE'
  },
  categorieId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'categorie',
      key: 'id'
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL'
  }
}, {
  tableName: 'produit',
  freezeTableName: true,
  timestamps: true,
  paranoid: true,
  underscored: true,
  // MED-08 : index sur les colonnes de recherche fréquentes
  indexes: [
    { fields: ['vendeur_id'] },
    { fields: ['categorie_id'] },
    { fields: ['disponible'] },
    { fields: ['vues'] },
  ]
});

module.exports = Produit;