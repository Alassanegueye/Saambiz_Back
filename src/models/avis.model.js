const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

// Avis (note + commentaire) laissé par un acheteur sur une boutique.
// Un acheteur ne peut laisser qu'un seul avis par boutique (index unique) ;
// un nouvel envoi met à jour l'avis existant.
const Avis = sequelize.define('Avis', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  acheteurId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'utilisateur', key: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
  },
  boutiqueId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'boutique', key: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
  },
  note: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: { min: 1, max: 5 },
  },
  commentaire: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
}, {
  tableName: 'avis',
  freezeTableName: true,
  timestamps: true,
  indexes: [
    { unique: true, fields: ['acheteurId', 'boutiqueId'] },
    { fields: ['boutiqueId'] },
  ],
});

module.exports = Avis;
