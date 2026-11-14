const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Notification = sequelize.define('Notification', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  titre: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  lue: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  type: {
    type: DataTypes.ENUM('nouveau_produit', 'promotion', 'abonnement', 'systeme', 'commande'),
    allowNull: false,
  },
  // Ce que la notification concerne, pour l'ouvrir d'un geste dans
  // l'application : interlocuteurId / interlocuteurNom (la conversation à
  // ouvrir), commandeId, boutiqueId…
  donnees: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {},
  },
  utilisateurId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'utilisateur',
      key: 'id'
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE'
  }
}, {
  tableName: 'notification',
  freezeTableName: true,
  indexes: [
    // Jointure fréquente : sans index, PostgreSQL parcourt la table entière.
    { fields: ['utilisateurId'] },
  ],
  timestamps: true
});

module.exports = Notification;
