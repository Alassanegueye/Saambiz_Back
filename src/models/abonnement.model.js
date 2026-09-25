// models/abonnement.model.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Abonnement = sequelize.define('Abonnement', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },

  utilisateurId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'utilisateur',
      key: 'id',
    },
    onDelete: 'CASCADE',
  },

  type: {
    type: DataTypes.ENUM('essai', 'mensuel'),
    allowNull: false,
  },

  dateDebut: {
    type: DataTypes.DATE,
    allowNull: false,
  },

  dateFin: {
    type: DataTypes.DATE,
    allowNull: false,
  },

  statut: {
    type: DataTypes.ENUM('actif', 'expire'),
    defaultValue: 'actif',
  },

  montant: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },

}, {
  tableName: 'abonnement',
  freezeTableName: true,
  timestamps: true,
  underscored: true,
  // MED-08 : index sur les colonnes de filtrage fréquentes
  indexes: [
    { fields: ['utilisateur_id'] },
    { fields: ['statut'] },
    { fields: ['date_fin'] },
  ],
});

// Méthode d'instance : vérifier si l'abonnement est encore actif
Abonnement.prototype.estActif = function () {
  return this.statut === 'actif' && new Date(this.dateFin) > new Date();
};

module.exports = Abonnement;