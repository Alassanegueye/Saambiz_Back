const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Menu = sequelize.define('Menu', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(100), allowNull: false },
  code: { type: DataTypes.STRING(50), allowNull: false, unique: true },
  path: { type: DataTypes.STRING(200), allowNull: false },
  icon: { type: DataTypes.STRING(100), allowNull: true },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true, allowNull: false },
  ordre: { type: DataTypes.INTEGER, defaultValue: 0 },
}, {
  tableName: 'menus',
  freezeTableName: true,
  paranoid: true,
  timestamps: true,
  underscored: false,
});

module.exports = Menu;
