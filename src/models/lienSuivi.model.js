const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * Lien de suivi d'une commande passée sans compte.
 *
 * Un client qui commande depuis le site d'une boutique n'a pas de compte : il
 * ne peut donc pas revenir voir où en est sa commande. Le suivi se faisait
 * par référence et numéro de téléphone — deux valeurs qui circulent par
 * WhatsApp, se recopient dans des conversations de groupe et s'énumèrent.
 *
 * À la place, un lien unique lui est envoyé par email. Trois choix tiennent
 * sa sûreté :
 *
 * 1. **Le jeton n'est jamais stocké en clair.** La base garde son empreinte
 *    SHA-256. Une copie de la base ne permet donc pas de fabriquer un lien :
 *    l'empreinte ne se renverse pas, et le jeton n'est pas chiffré — il n'y a
 *    aucune clé à voler pour le déchiffrer.
 * 2. **Le jeton est tiré au hasard**, 32 octets de `crypto.randomBytes`, soit
 *    256 bits. Il ne se devine pas et ne se déduit d'aucune donnée de la
 *    commande.
 * 3. **Il expire.** Quinze jours, c'est la durée de vie d'un lien qui traîne
 *    dans une boîte mail ; au-delà, le client en redemande un.
 *
 * Le lien donne accès aux commandes de l'ADRESSE, pas à une seule commande :
 * un client qui a commandé trois fois chez la même boutique les retrouve
 * toutes, et c'est aussi ce qui permet de lui rendre l'accès à partir de son
 * seul email quand son lien a expiré.
 */
const LienSuivi = sequelize.define('LienSuivi', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },

  // L'adresse qui a commandé. C'est elle que le lien ouvre, et c'est elle
  // qu'on redemande quand il a expiré.
  email: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },

  // SHA-256 du jeton, en hexadécimal : 64 caractères. Jamais le jeton lui-même.
  jetonHash: {
    type: DataTypes.STRING(64),
    allowNull: false,
    unique: true,
  },

  expiresAt: {
    type: DataTypes.DATE,
    allowNull: false,
  },

  // La commande à l'origine du lien, pour l'ouvrir directement sur celle-là.
  // Nulle quand le lien vient d'une demande « j'ai perdu mon lien ».
  commandeId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'commande', key: 'id' },
    onDelete: 'SET NULL',
  },

  // Dernière consultation : un lien jamais ouvert et un lien consulté hier
  // ne posent pas le même problème si l'adresse est compromise.
  derniereUtilisation: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'lien_suivi',
  freezeTableName: true,
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['jeton_hash'], unique: true },
    { fields: ['email'] },
    { fields: ['expires_at'] },
  ],
});

module.exports = LienSuivi;
