const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * Visite d'une boutique : une ligne par visiteur, par boutique et par jour,
 * qu'elle vienne de l'application ou du site de la boutique.
 *
 * `visiteur` est une empreinte SHA-256 (compte connecté, sinon adresse et
 * navigateur) : rien d'identifiant n'est stocké en clair. Voir
 * services/visites/visite.service.js et migrations/20261117_visites_boutique.sql.
 *
 * Sans association : le service la lit et l'écrit directement.
 */
const VisiteBoutique = sequelize.define('VisiteBoutique', {
  id: {
    type: DataTypes.BIGINT,
    autoIncrement: true,
    primaryKey: true,
  },
  boutiqueId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  jour: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
  visiteur: {
    type: DataTypes.CHAR(64),
    allowNull: false,
  },
  // 'app' ou 'site'
  canal: {
    type: DataTypes.STRING(10),
    allowNull: false,
  },
}, {
  tableName: 'visite_boutique',
  timestamps: true,
  updatedAt: false,
  underscored: true,
  indexes: [
    { name: 'visite_boutique_unique', unique: true, fields: ['boutique_id', 'jour', 'visiteur'] },
  ],
});

module.exports = VisiteBoutique;
