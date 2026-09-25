const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const ConfigApp = sequelize.define('ConfigApp', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  cle: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  valeur: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  description: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  modifiePar: {
    type: DataTypes.UUID,
    allowNull: true,
  },
}, {
  tableName: 'config_app',
  freezeTableName: true,
  timestamps: true,
  underscored: true,
});

module.exports = ConfigApp;
