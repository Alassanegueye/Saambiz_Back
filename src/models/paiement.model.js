// models/paiement.model.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Paiement = sequelize.define('Paiement', {
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

  abonnementId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'abonnement',
      key: 'id',
    },
    onDelete: 'SET NULL',
  },

  // Un paiement règle SOIT un abonnement (vendeur) SOIT une commande (acheteur)
  commandeId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'commande',
      key: 'id',
    },
    onDelete: 'SET NULL',
  },

  // 'abonnement' (par défaut, rétro-compatible) ou 'commande'
  type: {
    type: DataTypes.ENUM('abonnement', 'commande'),
    allowNull: false,
    defaultValue: 'abonnement',
  },

  methode: {
    type: DataTypes.ENUM('orange_money', 'wave'),
    allowNull: false,
  },

  montant: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: {
      min: 1,
    },
  },

  devise: {
    type: DataTypes.STRING(10),
    defaultValue: 'XOF',
  },

  statut: {
    type: DataTypes.ENUM('pending', 'success', 'failed', 'cancelled'),
    defaultValue: 'pending',
  },

  // pay_token retourné par Orange Money — sert à retrouver le paiement dans le webhook
  transactionId: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: true,        // un pay_token est unique
  },

  // order_id qu'on génère nous-mêmes — référence de rapprochement
  referencePaiement: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: true,
  },

  numeroTelephone: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },

  // Stocker la réponse complète Orange (payment_url, notif_token, etc.)
  metadata: {
    type: DataTypes.JSON,
    allowNull: true,
  },

  datePaiement: {
    type: DataTypes.DATE,
    allowNull: true,
  },

}, {
  tableName: 'paiement',
  freezeTableName: true,
  timestamps: true,
  underscored: true,
  // MED-08 : index sur colonnes de lookup fréquentes
  indexes: [
    { fields: ['utilisateur_id'] },
    // Jointures fréquentes : sans index, PostgreSQL parcourt la table entière.
    { fields: ['abonnement_id'] },
    { fields: ['commande_id'] },
    { fields: ['statut'] },
    { unique: true, fields: ['transaction_id'],       where: { transaction_id: { [require('sequelize').Op.ne]: null } } },
    { unique: true, fields: ['reference_paiement'],   where: { reference_paiement: { [require('sequelize').Op.ne]: null } } },
  ]
});

module.exports = Paiement;