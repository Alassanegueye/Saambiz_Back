const express = require('express');
const router = express.Router();
const adminController = require('../../controllers/admin/admin.controller');
const configController = require('../../controllers/admin/config.controller');
const auth = require('../../middlewares/auth.middleware');
const isAdmin = require('../../middlewares/isAdmin.middleware');
const checkActiveUser = require('../../middlewares/checkActiveUser.middleware');
const requirePermission = require('../../middlewares/requirePermission.middleware');

// Chaîne d'autorisation : identité → compte actif → rôle → permission fine.
// `isAdmin` ne vérifie que le rôle ; c'est `requirePermission`, posé route par
// route ci-dessous, qui applique réellement les droits accordés en base.
// Modèle strict : aucune permission enregistrée = aucun accès.
router.use(auth);
router.use(checkActiveUser);
router.use(isAdmin);

/**
 * @swagger
 * tags:
 *   name: Admin
 *   description: Gestion administrative (Admin uniquement)
 */

/**
 * @swagger
 * /admin/nombre-vendeurs-actif:
 *   get:
 *     summary: Nombre de vendeurs actifs
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Nombre de vendeurs actifs
 */
router.get('/nombre-vendeurs-actif',
  requirePermission('DASHBOARD', 'view'),
  adminController.nombreVendeursActif);

/**
 * @swagger
 * /admin/nombre-vendeurs-inactif:
 *   get:
 *     summary: Nombre de vendeurs inactifs
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Nombre de vendeurs inactifs
 */
router.get('/nombre-vendeurs-inactif',
  requirePermission('DASHBOARD', 'view'),
  adminController.nombreVendeursInactif);

/**
 * @swagger
 * /admin/liste-vendeurs:
 *   get:
 *     summary: Liste des vendeurs
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des vendeurs
 */
router.get('/liste-vendeurs',
  requirePermission('VENDEURS', 'view'),
  adminController.listeVendeur);

/**
 * @swagger
 * /admin/nombre-clients-actifs:
 *   get:
 *     summary: Nombre de clients actifs
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Nombre de clients actifs
 */
router.get('/nombre-clients-actifs',
  requirePermission('DASHBOARD', 'view'),
  adminController.nombreClientsActifs);

/**
 * @swagger
 * /admin/nombre-clients-inactifs:
 *   get:
 *     summary: Nombre de clients inactifs
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Nombre de clients inactifs
 */
router.get('/nombre-clients-inactifs',
  requirePermission('DASHBOARD', 'view'),
  adminController.nombreClientsInactifs);

/**
 * @swagger
 * /admin/liste-clients:
 *   get:
 *     summary: Liste des clients
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des clients
 */
router.get('/liste-clients',
  requirePermission('ACHETEURS', 'view'),
  adminController.listeClients);

/**
 * @swagger
 * /admin/liste-produits-actifs:
 *   get:
 *     summary: Liste des produits actifs
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des produits actifs
 */
router.get('/liste-produits-actifs',
  requirePermission('PRODUITS', 'view'),
  adminController.listeProduitsActifs);

/**
 * @swagger
 * /admin/nombre-produits-actifs:
 *   get:
 *     summary: Nombre de produits actifs
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Nombre de produits actifs
 */
router.get('/nombre-produits-actifs',
  requirePermission('DASHBOARD', 'view'),
  adminController.nombreProduitsActifs);

/**
 * @swagger
 * /admin/ajout-categorie:
 *   post:
 *     summary: Ajouter une catégorie
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nom:
 *                 type: string
 *                 example: Fruits
 *     responses:
 *       201:
 *         description: Catégorie ajoutée
 */
router.post('/ajout-categorie',
  requirePermission('CATEGORIES', 'create'),
  adminController.ajoutCategorie);

router.put('/vendeur/:id/suspendre',
  requirePermission('VENDEURS', 'update'),
  adminController.suspendreVendeur);
router.put('/vendeur/:id/activer',
  requirePermission('VENDEURS', 'update'),
  adminController.activerVendeur);
router.put('/acheteur/:id/suspendre',
  requirePermission('ACHETEURS', 'update'),
  adminController.suspendreAcheteur);
router.get('/abonnements',
  requirePermission('ABONNEMENTS', 'view'),
  adminController.getAbonnements);
router.get('/stats-globales',
  requirePermission('DASHBOARD', 'view'),
  adminController.getStatsGlobales);

// -------------------- MODÉRATION --------------------
router.put('/produit/:id/approuver',
  requirePermission('MODERATION', 'update'),
  adminController.approuverProduit);
router.put('/produit/:id/rejeter',
  requirePermission('MODERATION', 'update'),
  adminController.rejeterProduit);
router.delete('/produit/:id',
  requirePermission('PRODUITS', 'delete'),
  adminController.supprimerProduit);
router.delete('/boutique/:id',
  requirePermission('VENDEURS', 'delete'),
  adminController.supprimerBoutique);
router.delete('/supprimer-utilisateur/:id',
  requirePermission('ADMINS', 'delete'),
  adminController.supprimerUtilisateur);
router.put('/vendeur/:id/verifier',
  requirePermission('VALIDATION_VENDEURS', 'update'),
  adminController.verifierVendeur);

// Validation du profil vendeur (pièce justificative examinée par un admin)
router.get('/vendeurs-a-valider',
  requirePermission('VALIDATION_VENDEURS', 'view'),
  adminController.vendeursAValider);
router.put('/vendeur/:id/valider',
  requirePermission('VALIDATION_VENDEURS', 'update'),
  adminController.validerProfilVendeur);
router.put('/vendeur/:id/rejeter',
  requirePermission('VALIDATION_VENDEURS', 'update'),
  adminController.rejeterProfilVendeur);
router.get('/signalements',
  requirePermission('SIGNALEMENTS', 'view'),
  adminController.getSignalements);
router.put('/signalement/:id/traiter',
  requirePermission('SIGNALEMENTS', 'update'),
  adminController.traiterSignalement);
router.put('/signalement/:id/rejeter',
  requirePermission('SIGNALEMENTS', 'update'),
  adminController.rejeterSignalement);

// -------------------- CONFIGURATION APP --------------------
router.get('/configs',
  requirePermission('CONFIG', 'view'),
  configController.getAllConfigs);
router.get('/configs/prix-abonnement',
  requirePermission('CONFIG', 'view'),
  configController.getPrixAbonnement);
router.post('/configs',
  requirePermission('CONFIG', 'create'),
  configController.ajouterConfig);
router.put('/configs/:cle',
  requirePermission('CONFIG', 'update'),
  configController.modifierConfig);
// Alias pratique pour le dashboard : mise à jour directe du prix d'abonnement
router.put('/prix-abonnement',
  requirePermission('ABONNEMENTS', 'update'),
  adminController.updatePrixAbonnement);

// -------------------- KPIs --------------------
router.get('/revenus-mensuels',
  requirePermission('DASHBOARD', 'view'),
  adminController.revenusParMois);
router.get('/inscriptions-mensuelles',
  requirePermission('DASHBOARD', 'view'),
  adminController.inscriptionsMensuelles);
router.get('/abonnements-expiration',
  requirePermission('ABONNEMENTS', 'view'),
  adminController.abonnementsExpirationProche);

// -------------------- PAIEMENTS --------------------
router.get('/paiements',
  requirePermission('PAIEMENTS', 'view'),
  adminController.tousLesPaiements);
router.get('/paiements/echecs',
  requirePermission('PAIEMENTS', 'view'),
  adminController.paiementsEchoues);

// -------------------- ABONNEMENT MANUEL --------------------
router.post('/abonnement-manuel/:vendeurId',
  requirePermission('ABONNEMENTS', 'create'),
  adminController.abonnementManuel);
router.put('/abonnement/:id/revoquer',
  requirePermission('ABONNEMENTS', 'update'),
  adminController.revoquerAbonnement);

// -------------------- CATÉGORIES --------------------
router.put('/categorie/:id',
  requirePermission('CATEGORIES', 'update'),
  adminController.modifierCategorie);
router.delete('/categorie/:id',
  requirePermission('CATEGORIES', 'delete'),
  adminController.supprimerCategorie);

// -------------------- NOTIFICATION BROADCAST --------------------
router.post('/notification-globale',
  requirePermission('ADMINS', 'create'),
  adminController.notificationGlobale);

// -------------------- MODÉRATION AVANCÉE --------------------
router.get('/produits-en-attente',
  requirePermission('MODERATION', 'view'),
  adminController.produitsEnAttente);

// -------------------- COMMANDES (e-commerce) --------------------
router.get('/commandes',
  requirePermission('COMMANDES', 'view'),
  adminController.toutesCommandes);
router.get('/stats-ecommerce',
  requirePermission('DASHBOARD', 'view'),
  adminController.statsEcommerce);

// -------------------- DEMANDES DE RETOUR / REMBOURSEMENT --------------------
router.get('/demandes-retour',
  requirePermission('COMMANDES', 'view'),
  adminController.listerDemandesRetour);
router.put('/demandes-retour/:id/traiter',
  requirePermission('COMMANDES', 'update'),
  adminController.traiterDemandeRetour);

// -------------------- LOGS D'AUDIT --------------------
router.get('/audit-logs',
  requirePermission('ADMINS', 'view'),
  adminController.listerAuditLogs);

module.exports = router;