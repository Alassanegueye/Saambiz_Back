const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Categorie = sequelize.define('Categorie', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  nom: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  description: {
    type: DataTypes.STRING,
    allowNull: true,
  },
}, {
  tableName: 'categorie',
  freezeTableName: true,
  timestamps: true,
  paranoid: true,
  underscored: true
});

module.exports = Categorie;