// models/historiqueCommande.model.js
//
// Historique d'une commande : qui a fait quoi, quand, et depuis quel état.
//
// Le journal d'audit existant (audit_log) ne convenait pas : son `adminId`
// est obligatoire et référence un administrateur, alors qu'ici l'auteur est
// le plus souvent un acheteur ou un vendeur. Et la liste du back-office,
// pensée pour les actions d'administration, serait noyée sous les
// changements de statut ordinaires.
//
// RIEN N'EST MODIFIABLE : pas d'`updatedAt`, aucune route d'écriture ni de
// suppression. Une ligne posée reste.
const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const HistoriqueCommande = sequelize.define('HistoriqueCommande', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  commandeId: {
    type: DataTypes.UUID,
    allowNull: false,
  },

  /// L'auteur. NULL quand l'opération vient du système : encaissement
  /// confirmé par la passerelle de paiement, tâche planifiée.
  auteurId: {
    type: DataTypes.UUID,
    allowNull: true,
  },

  /// Sous quelle casquette : 'acheteur', 'vendeur', 'admin' ou 'systeme'.
  auteurRole: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'systeme',
  },

  /// Ce qui a été fait : 'creation', 'statut', 'paiement', 'annulation',
  /// 'demande_annulation', 'reponse_annulation'.
  operation: {
    type: DataTypes.STRING,
    allowNull: false,
  },

  statutAvant: { type: DataTypes.STRING, allowNull: true },
  statutApres: { type: DataTypes.STRING, allowNull: true },
  paiementAvant: { type: DataTypes.STRING, allowNull: true },
  paiementApres: { type: DataTypes.STRING, allowNull: true },

  /// Motif d'une annulation, d'un refus, d'une correction.
  motif: { type: DataTypes.TEXT, allowNull: true },

  /// Ce que l'opération portait d'autre, si besoin.
  details: { type: DataTypes.JSONB, allowNull: true },
}, {
  tableName: 'historique_commande',
  freezeTableName: true,
  timestamps: true,
  updatedAt: false, // une ligne d'historique ne se modifie pas
  underscored: true,
  indexes: [
    { fields: ['commande_id'] },
    { fields: ['auteur_id'] },
    { fields: ['operation'] },
  ],
});

module.exports = HistoriqueCommande;
