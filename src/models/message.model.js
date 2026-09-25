const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Message = sequelize.define('Message', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  contenu: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  lu: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  expediteurId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'utilisateur',
      key: 'id'
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE'
  },
  destinataireId: {
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
  tableName: 'message',
  freezeTableName: true,
  indexes: [
    // Jointure fréquente : sans index, PostgreSQL parcourt la table entière.
    { fields: ['destinataireId'] },
    // Jointure fréquente : sans index, PostgreSQL parcourt la table entière.
    { fields: ['expediteurId'] },
  ],
  timestamps: true
});

module.exports = Message;
