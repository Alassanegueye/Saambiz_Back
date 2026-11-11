const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * Question du centre d'aide de l'application, rédigée et modifiée depuis le
 * dashboard admin (Configuration → Centre d'aide).
 */
const QuestionFrequente = sequelize.define('QuestionFrequente', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  question: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  reponse: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  // Position dans la liste (croissante).
  ordre: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  // Masquée de l'application sans être supprimée.
  active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
}, {
  tableName: 'question_frequente',
  freezeTableName: true,
  timestamps: true,
  underscored: true,
});

module.exports = QuestionFrequente;
