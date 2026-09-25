const express = require('express');
const router = express.Router();
const VendeurController = require('../../controllers/vendeurs/vendeur.controller');
const authMiddleware = require('../../middlewares/auth.middleware');
const checkActiveUser = require('../../middlewares/checkActiveUser.middleware');
const isVendeur = require('../../middlewares/isVendeur.middleware');
const finAbonnement = require('../../middlewares/finAbonnement.middleware');
const upload = require('../../middlewares/upload.middleware');

router.use(authMiddleware);
router.use(checkActiveUser);
router.use(isVendeur);

/**
 * @swagger
 * tags:
 *   name: Vendeurs
 *   description: Gestion des produits côté vendeur
 */

/**
 * @swagger
 * /vendeurs/liste-produits:
 *   get:
 *     summary: Lister les produits du vendeur connecté
 *     tags: [Vendeurs]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des produits
 */
router.get('/liste-produits', VendeurController.listerProduits);

/**
 * @swagger
 * /vendeurs/ajout-produit:
 *   post:
 *     summary: Ajouter un produit
 *     tags: [Vendeurs]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               nom:
 *                 type: string
 *               description:
 *                 type: string
 *               prix:
 *                 type: number
 *               categorieId:
 *                 type: string
 *               image:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Produit ajouté
 */
router.post(
  '/ajout-produit',
  finAbonnement,
  upload.single('image'),
  upload.verifyMagicBytes,
  VendeurController.ajouterProduit
);

/**
 * @swagger
 * /vendeurs/modifier-produit/{id}:
 *   put:
 *     summary: Modifier un produit
 *     tags: [Vendeurs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID du produit
 *     requestBody:
 *       required: false
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               nom:
 *                 type: string
 *               description:
 *                 type: string
 *               prix:
 *                 type: number
 *               categorieId:
 *                 type: string
 *               image:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Produit modifié
 */
router.put(
  '/modifier-produit/:id',
  finAbonnement,
  upload.single('image'),
  upload.verifyMagicBytes,
  VendeurController.modifierProduit
);

/**
 * @swagger
 * /vendeurs/supprimer-produit/{id}:
 *   delete:
 *     summary: Supprimer un produit
 *     tags: [Vendeurs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Produit supprimé
 */
router.delete(
  '/supprimer-produit/:id',
  finAbonnement,
  VendeurController.supprimerProduit
);

/**
 * @swagger
 * /vendeurs/nombre-produit:
 *   get:
 *     summary: Nombre total de produits du vendeur
 *     tags: [Vendeurs]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Nombre total
 */
router.get('/nombre-produit', VendeurController.nombreProduits);

/**
 * @swagger
 * /vendeurs/nombre-produit-categorie:
 *   get:
 *     summary: Nombre de produits par catégorie
 *     tags: [Vendeurs]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Statistiques par catégorie
 */
router.get('/nombre-produit-categorie', VendeurController.produitsParCategorie);

// -------------------- BOUTIQUE --------------------
// Personnalisation : logo + bannière uploadables
const boutiqueUpload = upload.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'banniere', maxCount: 1 },
]);
router.get('/ma-boutique', VendeurController.maBoutique);
// -------------------- VÉRIFICATION DU PROFIL --------------------
// Le vendeur transmet une pièce justificative ; un administrateur tranche
// depuis le back-office. Pas de finAbonnement ici : un vendeur dont
// l'abonnement a expiré doit pouvoir régulariser son profil.
router.post(
  '/soumettre-verification',
  upload.fields([{ name: 'piece', maxCount: 1 }]),
  upload.verifyMagicBytes,
  VendeurController.soumettreVerification
);
router.get('/statut-verification', VendeurController.statutVerification);

router.post('/creer-boutique',
  boutiqueUpload,
  upload.verifyMagicBytes,
  VendeurController.creerBoutique);
router.put('/modifier-boutique',
  boutiqueUpload,
  upload.verifyMagicBytes,
  VendeurController.modifierBoutique);

// -------------------- ASSISTANT DE CRÉATION DU SITE --------------------
// Appelé par l'application mobile : c'est là que le site se crée. Pas de
// finAbonnement — un vendeur dont l'abonnement a expiré doit pouvoir
// composer son site, c'est même ce qui lui donnera envie de le renouveler.
router.get('/vitrine/secteurs', VendeurController.secteursVitrine);

router.post(
  '/vitrine/analyser-logo',
  upload.fields([{ name: 'logo', maxCount: 1 }]),
  upload.verifyMagicBytes,
  VendeurController.analyserLogoVitrine
);

router.post(
  '/vitrine/generer',
  upload.fields([{ name: 'logo', maxCount: 1 }]),
  upload.verifyMagicBytes,
  VendeurController.genererVitrine
);

// -------------------- VITRINE : LE SITE WEB DE LA BOUTIQUE --------------------
// Pas de finAbonnement sur la lecture : un vendeur dont l'abonnement a expiré
// doit pouvoir consulter l'adresse de son site et la reprendre. L'écriture,
// elle, est un acte de gestion comme un autre.
router.get('/ma-vitrine', VendeurController.maVitrine);
router.put('/ma-vitrine', finAbonnement, VendeurController.majVitrine);

// -------------------- ABONNEMENT --------------------
router.get('/mon-abonnement', VendeurController.monAbonnement);
router.post('/initier-renouvellement', VendeurController.initierRenouvellement);

// -------------------- STATISTIQUES VUES --------------------
router.get('/statistiques-vues', VendeurController.statistiquesVues);

// -------------------- DASHBOARD --------------------
router.get('/dashboard', VendeurController.dashboard);

// -------------------- STATISTIQUES AVANCÉES --------------------
router.get('/statistiques', VendeurController.statistiquesAvancees);

// -------------------- DISPONIBILITÉ RAPIDE --------------------
router.patch('/produit/:id/disponibilite', finAbonnement, VendeurController.toggleDisponibilite);

// -------------------- DUPLIQUER PRODUIT --------------------
router.post('/produit/:id/dupliquer', finAbonnement, VendeurController.dupliquerProduit);

// -------------------- RECHERCHE PRODUITS --------------------
router.get('/recherche-produits', VendeurController.rechercherMesProduits);

// -------------------- MODE PAUSE BOUTIQUE --------------------
router.patch('/boutique/pause', VendeurController.pauseBoutique);
router.patch('/boutique/reactiver', VendeurController.reactiverBoutique);

// -------------------- HISTORIQUE PAIEMENTS --------------------
router.get('/historique-paiements', VendeurController.historiquePaiements);

// -------------------- MES CONVERSATIONS --------------------
router.get('/mes-conversations', VendeurController.mesConversations);

// -------------------- IMAGES MULTIPLES PRODUIT --------------------
router.post(
  '/produit/:id/images',
  finAbonnement,
  upload.array('images', 8),
  upload.verifyMagicBytes,
  VendeurController.ajouterImagesProduit
);
router.delete(
  '/produit/:id/images/:imageId',
  finAbonnement,
  VendeurController.supprimerImageProduit
);

module.exports = router;