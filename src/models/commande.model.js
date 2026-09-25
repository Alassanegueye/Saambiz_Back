// models/commande.model.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Commande = sequelize.define('Commande', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },

  // Référence lisible pour le suivi (ex: CMD-2026-XXXX)
  referenceCommande: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },

  // Acheteur qui passe la commande — NUL pour une commande passée depuis le
  // site d'une boutique. Le site existe précisément pour épargner au client la
  // création d'un compte : ses coordonnées sont alors portées par la commande
  // elle-même (champs `client*` ci-dessous).
  acheteurId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'utilisateur', key: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
  },

  // ── Coordonnées du client, quand il n'a pas de compte ───────────────
  // Renseignées pour une commande venue du site d'une boutique ; nulles pour
  // une commande passée dans l'application, où elles se lisent sur le compte.
  clientNom: {
    type: DataTypes.STRING(120),
    allowNull: true,
  },
  clientPrenom: {
    type: DataTypes.STRING(120),
    allowNull: true,
  },
  // Sert aussi de clé de suivi : référence + téléphone donnent accès au
  // détail de la commande, sans compte.
  clientTelephone: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  clientEmail: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },

  // Vendeur concerné (une commande = une boutique/un vendeur)
  vendeurId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'utilisateur', key: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
  },

  // Montant des produits (hors livraison)
  montantProduits: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0,
  },

  fraisLivraison: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0,
  },

  // montantProduits + fraisLivraison
  montantTotal: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0,
  },

  // Cycle de vie de la commande
  statut: {
    type: DataTypes.ENUM(
      'en_attente',     // créée, en attente de paiement / confirmation
      'confirmee',      // payée ou acceptée (à la livraison)
      'en_preparation', // le vendeur prépare
      'prete',          // prête (retrait) / prête à expédier
      'en_livraison',   // en cours de livraison
      'livree',         // terminée
      'annulee',        // annulée
    ),
    allowNull: false,
    defaultValue: 'en_attente',
  },

  statutPaiement: {
    type: DataTypes.ENUM('non_paye', 'paye', 'rembourse'),
    allowNull: false,
    defaultValue: 'non_paye',
  },

  modeLivraison: {
    type: DataTypes.ENUM('livraison', 'retrait'),
    allowNull: false,
    defaultValue: 'livraison',
  },

  modePaiement: {
    type: DataTypes.ENUM('en_ligne', 'a_la_livraison'),
    allowNull: false,
    defaultValue: 'en_ligne',
  },

  adresseLivraison: {
    type: DataTypes.STRING,
    allowNull: true,
  },

  numeroTelephone: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },

  note: {
    type: DataTypes.TEXT,
    allowNull: true,
  },

  // D'où vient la commande : 'application' (mobile), 'vitrine' (le site web
  // de la boutique) ou 'dashboard'. C'est ce qui dit au vendeur si son site
  // lui rapporte réellement des ventes.
  origine: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'application',
  },

  // Indique si le stock a déjà été décrémenté (évite un double décrément)
  stockDecremente: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },

}, {
  tableName: 'commande',
  freezeTableName: true,
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['acheteur_id'] },
    // L'index sur `client_telephone` — le suivi d'une commande sans compte
    // part de la — est cree par la migration, pas declare ici.
    //
    // Le bootstrap lance `sequelize.sync()` AVANT les migrations, pour que les
    // tables existent quand celles-ci les modifient. Consequence : sur une base
    // deja peuplee, sync tenterait de creer cet index sur une colonne que la
    // migration n'a pas encore ajoutee, et le demarrage echouerait en boucle
    // sur « column client_telephone does not exist ».
    //
    // Regle generale : un index sur une colonne apportee par une migration se
    // declare dans cette migration.
    { fields: ['vendeur_id'] },
    { fields: ['statut'] },
    { fields: ['statut_paiement'] },
    { unique: true, fields: ['reference_commande'] },
  ],
});

module.exports = Commande;
