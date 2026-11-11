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
  // Compte supprimé par son titulaire : les données restent en base, mais
  // on ne peut plus s'y connecter, ni réutiliser son e-mail ou son numéro.
  compteSupprime: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  dateSuppression: {
    type: DataTypes.DATE,
    allowNull: true,
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
  // Verso de la pièce d'identité (le recto est dans `pieceIdentite`).
  pieceIdentiteVerso: {
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
  // Première connexion réussie (jamais réécrite) et la plus récente.
  premiereConnexion: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  derniereConnexion: {
    type: DataTypes.DATE,
    allowNull: true,
  },

  // Montant disponible sur le compte du vendeur, en FCFA.
  //
  // Rien ne l'alimente ni ne le debite pour l'instant : la colonne est posee
  // pour que l'ecran « Compte » du vendeur ait une valeur a afficher, et pour
  // que la donnee soit deja la le jour ou les reversements seront traites.
  //
  // DECIMAL et non FLOAT : un solde est de l'argent, et l'arrondi binaire
  // d'un flottant finit par ne plus tomber juste. Douze chiffres au lieu des
  // dix habituels parce qu'un solde s'accumule, la ou un prix unitaire ne
  // s'accumule pas.
  soldeDisponible: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0,
  },

}, {
  tableName: 'utilisateur',
  freezeTableName: true,
  timestamps: true,
  paranoid: true,
  underscored: true
});

// Prénom « Awa », nom « DIOP », boutique « Chez awa » — quelle que soit la saisie.
const { formaterPrenom, formaterNom, appliquerFormats } = require('../utils/formatNoms');
appliquerFormats(User, { prenom: formaterPrenom, nom: formaterNom });

module.exports = User;
