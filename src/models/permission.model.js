const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Permission = sequelize.define('Permission', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'utilisateur', key: 'id' },
  },
  menuId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'menus', key: 'id' },
  },
  canView:   { type: DataTypes.BOOLEAN, defaultValue: false },
  canCreate: { type: DataTypes.BOOLEAN, defaultValue: false },
  canUpdate: { type: DataTypes.BOOLEAN, defaultValue: false },
  canDelete: { type: DataTypes.BOOLEAN, defaultValue: false },
}, {
  tableName: 'permissions',
  freezeTableName: true,
  timestamps: true,
  underscored: false,
  indexes: [{ unique: true, fields: ['userId', 'menuId'] }],
});

module.exports = Permission;
