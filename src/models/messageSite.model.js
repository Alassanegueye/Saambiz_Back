const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * Message laissé sur la page « Contact » du site d'une boutique.
 *
 * Le visiteur n'a pas de compte : il laisse son nom et son numéro, et le
 * vendeur le retrouve dans « Messages », sur l'application comme sur le
 * dashboard. La réponse part par WhatsApp ou par téléphone — c'est le seul
 * canal que le visiteur a donné.
 */
const MessageSite = sequelize.define('MessageSite', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  vendeurId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'vendeur_id',
    references: { model: 'utilisateur', key: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
  },
  nom: {
    type: DataTypes.STRING(120),
    allowNull: true,
  },
  telephone: {
    type: DataTypes.STRING(30),
    allowNull: false,
  },
  contenu: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  lu: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
}, {
  tableName: 'message_site',
  freezeTableName: true,
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['vendeur_id', 'created_at'] },
  ],
});

module.exports = MessageSite;
