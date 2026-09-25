const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const User = sequelize.define('User', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  nom: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  prenom: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: { isEmail: true }
  },
  mot_de_passe: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  adresse: {
    type: DataTypes.STRING,
    allowNull: true, // LOW-06 : cohérence avec le validator (champ optionnel)
  },
  telephone: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: true
  },
  photoProfil: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  
  role: {
    type: DataTypes.ENUM('Admin', 'Acheteur', 'Vendeur'),
    defaultValue: 'Acheteur',
    allowNull: false
    },
  statut: {
    type: DataTypes.ENUM('actif', 'inactif'),
    defaultValue: 'actif'
  },
  // Adresse email confirmée (code à 6 chiffres reçu à l'inscription).
  verifie: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },

  // ── Validation du profil vendeur par un administrateur ──────────────
  // Distinct de `verifie` : confirmer son email prouve qu'on lit ses
  // messages, pas qu'on est un vendeur sérieux. Seuls les profils
  // approuvés portent le badge « Boutique vérifiée » et remontent dans
  // les sélections de l'accueil.
  statutValidation: {
    type: DataTypes.ENUM('non_soumis', 'en_attente', 'approuve', 'rejete'),
    defaultValue: 'non_soumis',
    allowNull: false,
  },
  pieceIdentite: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  typePiece: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  motifRejet: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  dateSoumission: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  dateValidation: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  validePar: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  isFirstLogin: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false,
  },

}, {
  tableName: 'utilisateur',
  freezeTableName: true,
  timestamps: true,
  paranoid: true,
  underscored: true
});

module.exports = User;
