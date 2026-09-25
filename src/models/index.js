const sequelize = require('../config/db');
const Boutique = require('./boutique.model');
const VerificationEmail = require('./verificationEmail.model');
const Utilisateur = require('./utilisateur.model');
const Menu = require('./menu.model');
const Permission = require('./permission.model');
const Produit = require('./produit.model');
const Categorie = require('./categorie.model');
const Abonnement = require('./abonnement.model');
const Paiement = require('./paiement.model');
const Commande = require('./commande.model');
const LigneCommande = require('./ligneCommande.model');
const UserOtp = require('./userOtp.model');
const Favori = require('./favori.model');
const Message = require('./message.model');
const Promotion = require('./promotion.model');
const Notification = require('./notification.model');
const Signalement = require('./signalement.model');
const TokenBlacklist = require('./tokenBlacklist.model');
const RefreshToken   = require('./refreshToken.model');
const ConfigApp = require('./configApp.model');
const DeviceToken = require('./deviceToken.model');
const ProduitImage = require('./produitImage.model');
const DemandeRetour = require('./demandeRetour.model');
const AuditLog = require('./auditLog.model');
const Avis = require('./avis.model');
const PreferenceClient = require('./preferenceClient.model');

// ===================== ASSOCIATIONS EXISTANTES =====================

Utilisateur.hasMany(Boutique, { foreignKey: 'vendeurId', as: 'boutiques' });
Boutique.belongsTo(Utilisateur, { foreignKey: 'vendeurId', as: 'vendeur' });

Utilisateur.hasMany(Produit, { foreignKey: 'vendeurId', as: 'produits' });
Produit.belongsTo(Utilisateur, { foreignKey: 'vendeurId', as: 'vendeur' });

Categorie.hasMany(Produit, { foreignKey: 'categorieId', as: 'produits' });
Produit.belongsTo(Categorie, { foreignKey: 'categorieId', as: 'categorie' });

Utilisateur.hasMany(Abonnement, { foreignKey: 'utilisateurId', as: 'abonnements' });
Abonnement.belongsTo(Utilisateur, { foreignKey: 'utilisateurId', as: 'utilisateur' });

Utilisateur.hasMany(Paiement, { foreignKey: 'utilisateurId', as: 'paiements' });
Paiement.belongsTo(Utilisateur, { foreignKey: 'utilisateurId', as: 'utilisateur' });

Abonnement.hasMany(Paiement, { foreignKey: 'abonnementId', as: 'paiements' });
Paiement.belongsTo(Abonnement, { foreignKey: 'abonnementId', as: 'abonnement' });

// ===================== COMMANDES =====================

// Acheteur ↔ Commandes
Utilisateur.hasMany(Commande, { foreignKey: 'acheteurId', as: 'commandesAchetees' });
Commande.belongsTo(Utilisateur, { foreignKey: 'acheteurId', as: 'acheteur' });

// Vendeur ↔ Commandes reçues
Utilisateur.hasMany(Commande, { foreignKey: 'vendeurId', as: 'commandesRecues' });
Commande.belongsTo(Utilisateur, { foreignKey: 'vendeurId', as: 'vendeur' });

// Commande ↔ Lignes
Commande.hasMany(LigneCommande, { foreignKey: 'commandeId', as: 'lignes' });
LigneCommande.belongsTo(Commande, { foreignKey: 'commandeId', as: 'commande' });

// Ligne ↔ Produit (snapshot conservé même si le produit est supprimé)
Produit.hasMany(LigneCommande, { foreignKey: 'produitId', as: 'lignesCommande' });
LigneCommande.belongsTo(Produit, { foreignKey: 'produitId', as: 'produit' });

// Commande ↔ Paiement
Commande.hasMany(Paiement, { foreignKey: 'commandeId', as: 'paiements' });
Paiement.belongsTo(Commande, { foreignKey: 'commandeId', as: 'commande' });

// ===================== FAVORIS =====================

Utilisateur.hasMany(Favori, { foreignKey: 'acheteurId', as: 'favoris' });
Boutique.hasMany(Favori, { foreignKey: 'boutiqueId', as: 'favoris' });
Favori.belongsTo(Utilisateur, { foreignKey: 'acheteurId', as: 'acheteur' });
Favori.belongsTo(Boutique, { foreignKey: 'boutiqueId', as: 'boutique' });

// ===================== MESSAGES =====================

Utilisateur.hasMany(Message, { foreignKey: 'expediteurId', as: 'messagesEnvoyes' });
Utilisateur.hasMany(Message, { foreignKey: 'destinataireId', as: 'messagesRecus' });
Message.belongsTo(Utilisateur, { foreignKey: 'expediteurId', as: 'expediteur' });
Message.belongsTo(Utilisateur, { foreignKey: 'destinataireId', as: 'destinataire' });

// ===================== PROMOTIONS =====================

Produit.hasMany(Promotion, { foreignKey: 'produitId', as: 'promotions' });
Utilisateur.hasMany(Promotion, { foreignKey: 'vendeurId', as: 'promotions' });
Promotion.belongsTo(Produit, { foreignKey: 'produitId' });
Promotion.belongsTo(Utilisateur, { foreignKey: 'vendeurId', as: 'vendeur' });

// ===================== NOTIFICATIONS =====================

Utilisateur.hasMany(Notification, { foreignKey: 'utilisateurId', as: 'notifications' });
Notification.belongsTo(Utilisateur, { foreignKey: 'utilisateurId' });

// ===================== USER OTP =====================

Utilisateur.hasOne(UserOtp, { foreignKey: 'utilisateurId', as: 'otp' });
UserOtp.belongsTo(Utilisateur, { foreignKey: 'utilisateurId' });

// ===================== SIGNALEMENTS =====================

Utilisateur.hasMany(Signalement, { foreignKey: 'signaleurId', as: 'signalements' });
Signalement.belongsTo(Utilisateur, { foreignKey: 'signaleurId', as: 'signaleur' });

// ===================== DEVICE TOKENS (FCM push) =====================

Utilisateur.hasMany(DeviceToken, { foreignKey: 'utilisateurId', as: 'deviceTokens' });
DeviceToken.belongsTo(Utilisateur, { foreignKey: 'utilisateurId', as: 'utilisateur' });

// ===================== RBAC : MENUS & PERMISSIONS =====================

Utilisateur.hasMany(Permission, { foreignKey: 'userId', as: 'permissions' });
Permission.belongsTo(Utilisateur, { foreignKey: 'userId', as: 'utilisateur' });

Menu.hasMany(Permission, { foreignKey: 'menuId', as: 'permissions' });
Permission.belongsTo(Menu, { foreignKey: 'menuId', as: 'menu' });

// ===================== IMAGES MULTIPLES PRODUIT =====================

Produit.hasMany(ProduitImage, { foreignKey: 'produitId', as: 'images' });
ProduitImage.belongsTo(Produit, { foreignKey: 'produitId' });

// ===================== DEMANDES DE RETOUR / REMBOURSEMENT =====================

Commande.hasMany(DemandeRetour, { foreignKey: 'commandeId', as: 'demandesRetour' });
DemandeRetour.belongsTo(Commande, { foreignKey: 'commandeId', as: 'commande' });

Utilisateur.hasMany(DemandeRetour, { foreignKey: 'acheteurId', as: 'demandesRetour' });
DemandeRetour.belongsTo(Utilisateur, { foreignKey: 'acheteurId', as: 'acheteur' });

// ===================== AUDIT LOG (ADMIN) =====================

Utilisateur.hasMany(AuditLog, { foreignKey: 'adminId', as: 'auditLogs' });
AuditLog.belongsTo(Utilisateur, { foreignKey: 'adminId', as: 'admin' });

// ===================== AVIS (NOTATION BOUTIQUE) =====================

Utilisateur.hasMany(Avis, { foreignKey: 'acheteurId', as: 'avis' });
Avis.belongsTo(Utilisateur, { foreignKey: 'acheteurId', as: 'acheteur' });

Boutique.hasMany(Avis, { foreignKey: 'boutiqueId', as: 'avis' });
Avis.belongsTo(Boutique, { foreignKey: 'boutiqueId', as: 'boutique' });

// Sessions : un utilisateur peut être connecté sur plusieurs appareils,
// dans la limite du plafond fixé par refreshTokenConfig.
Utilisateur.hasMany(RefreshToken, { foreignKey: 'utilisateurId', as: 'sessions', onDelete: 'CASCADE' });
RefreshToken.belongsTo(Utilisateur, { foreignKey: 'utilisateurId', as: 'utilisateur' });

// Préférences d'accueil : une ligne par acheteur connecté.
Utilisateur.hasOne(PreferenceClient, { foreignKey: 'utilisateurId', as: 'preferences' });
PreferenceClient.belongsTo(Utilisateur, { foreignKey: 'utilisateurId', as: 'utilisateur' });

module.exports = {
  sequelize,
  Utilisateur, Produit, Categorie, Boutique, Abonnement, Paiement,
  Commande, LigneCommande,
  UserOtp, Favori, Message, Promotion, Notification,
  Signalement, TokenBlacklist, RefreshToken, ConfigApp, DeviceToken,
  Menu, Permission,
  ProduitImage, DemandeRetour, AuditLog, Avis, PreferenceClient,
  VerificationEmail,
};
