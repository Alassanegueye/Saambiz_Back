const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

// Lien boutique ↔ catégorie : 1 à 3 catégories par boutique, dont une
// principale. Le plafond est tenu par CategorieBoutiqueService ; l'unicité
// de la principale par un index partiel posé dans la migration
// 20261019_structure_categories.sql.
const BoutiqueCategorie = sequelize.define('BoutiqueCategorie', {
  boutiqueId: {
    type: DataTypes.UUID,
    primaryKey: true,
    allowNull: false,
    references: { model: 'boutique', key: 'id' },
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  },
  categorieId: {
    type: DataTypes.UUID,
    primaryKey: true,
    allowNull: false,
    references: { model: 'categorie', key: 'id' },
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  },
  principale: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
}, {
  tableName: 'boutique_categorie',
  freezeTableName: true,
  timestamps: true,
  underscored: true,
});

module.exports = BoutiqueCategorie;
