const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Favori = sequelize.define('Favori', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  acheteurId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'utilisateur',
      key: 'id'
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE'
  },
  boutiqueId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'boutique',
      key: 'id'
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE'
  },
  // 🔔 Cloche : quand active, l'acheteur reçoit les notifications
  // (nouveaux produits, promotions) de la boutique suivie.
  clocheActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  }
}, {
  tableName: 'favori',
  freezeTableName: true,
  timestamps: true,
  indexes: [
    {
      unique: true,
      fields: ['acheteurId', 'boutiqueId']
    }
  ]
});

module.exports = Favori;
