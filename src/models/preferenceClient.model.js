const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * Ce qui personnalise l'accueil d'un client.
 *
 * Une ligne par acheteur connecté. Les invités n'y figurent pas : leurs
 * centres d'intérêt restent sur leur téléphone et voyagent dans la requête,
 * jusqu'à ce qu'ils créent un compte — la ligne est alors créée avec ces
 * mêmes valeurs.
 */
const PreferenceClient = sequelize.define('PreferenceClient', {
  utilisateurId: {
    type: DataTypes.UUID,
    primaryKey: true,
    allowNull: false,
  },

  // Catégories choisies à l'inscription (« Mode », « Beauté »…).
  interets: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: [],
  },

  // Dernière position connue, si la géolocalisation a été autorisée.
  latitude:  { type: DataTypes.DECIMAL(10, 8), allowNull: true },
  longitude: { type: DataTypes.DECIMAL(11, 8), allowNull: true },
  ville:     { type: DataTypes.STRING,         allowNull: true },
  positionMajLe: { type: DataTypes.DATE,       allowNull: true },

  // Les 20 dernières recherches : [{ terme, date }]
  recherchesRecentes: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: [],
  },

  /**
   * Score par catégorie : { "Mode": 12.5, "Beauté": 3 }.
   *
   * Alimenté par ce que le client fait vraiment — consulter un produit,
   * rechercher un terme, s'abonner à une boutique, acheter. C'est ce qui
   * fait bouger l'accueil au fil des jours sans que le client ait à
   * retoucher ses centres d'intérêt.
   */
  affinites: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {},
  },
}, {
  tableName: 'preference_client',
  freezeTableName: true,
  indexes: [
    // Jointure fréquente : sans index, PostgreSQL parcourt la table entière.
    { fields: ['utilisateur_id'] },
  ],
  timestamps: true,
  underscored: true,
});

module.exports = PreferenceClient;
