const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const DeviceToken = sequelize.define('DeviceToken', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  utilisateurId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  token: {
    type: DataTypes.TEXT,
    allowNull: false,
    unique: true
  },
  platform: {
    type: DataTypes.ENUM('android', 'ios', 'web'),
    allowNull: false,
    defaultValue: 'android'
  }
}, {
  tableName: 'device_tokens',
  freezeTableName: true,
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['utilisateur_id'] }
  ]
});

module.exports = DeviceToken;
