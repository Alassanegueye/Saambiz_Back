const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

// Catégorie de la marketplace — un seul niveau (pas de sous-rayons).
// Une boutique en a 1 à 3 (via boutique_categorie), un produit une seule.
//
// Les index (slug unique, active+ordre) sont posés par la migration
// 20261019_structure_categories.sql et volontairement PAS déclarés ici :
// sync() tenterait de les créer sur une table existante avant que la
// migration n'ait ajouté les colonnes, et le démarrage échouerait.
const Categorie = sequelize.define('Categorie', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  nom: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  // Identifiant stable : ne change pas quand l'admin renomme la catégorie.
  slug: {
    type: DataTypes.STRING(80),
    allowNull: true,
  },
  description: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  // Nom d'icône Material ('checkroom', 'spa'…), interprété par l'application.
  icone: {
    type: DataTypes.STRING(40),
    allowNull: true,
  },
  // Visuel optionnel pour les tuiles de l'accueil.
  image: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
  // Position dans la liste (croissante).
  ordre: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  // Spécifications que le vendeur renseigne en ajoutant un produit de cette
  // catégorie (tailles, pointures, contenance…). Format décrit dans
  // src/constants/specificationsCategories.js.
  specifications: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: [],
  },
  // Masquée : disparaît de l'application, ses produits et boutiques restent.
  active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
}, {
  tableName: 'categorie',
  freezeTableName: true,
  timestamps: true,
  paranoid: true,
  underscored: true
});

module.exports = Categorie;