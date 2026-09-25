const express = require('express');
const router = express.Router();
const AcheteurController = require('../../controllers/acheteurs/acheteurs.controller');
const AccueilController = require('../../controllers/acheteurs/accueil.controller');
const authMiddleware = require('../../middlewares/auth.middleware');
const authOptionnel = require('../../middlewares/authOptionnel.middleware');

// -------------------- ACCUEIL PERSONNALISÉ (INVITÉS ET CLIENTS) --------------
// Déclaré AVANT le authMiddleware global : l'application doit pouvoir
// afficher un accueil à un visiteur qui a choisi « continuer sans compte ».
// Le jeton, s'il est présent, enrichit la réponse (boutiques suivies,
// affinités) mais n'est pas exigé.
router.get('/accueil-personnalise', authOptionnel, AccueilController.accueilPersonnalise);

// Toutes les routes suivantes exigent une session.
router.use(authMiddleware);

// -------------------- PRÉFÉRENCES D'ACCUEIL --------------------
router.get('/preferences', AccueilController.getPreferences);
router.put('/preferences', AccueilController.majPreferences);

/**
 * @swagger
 * tags:
 *   name: Acheteurs
 *   description: Gestion des fonctionnalités côté acheteur
 */

/**
 * @swagger
 * /acheteurs/liste-produits:
 *   get:
 *     summary: Lister tous les produits
 *     tags: [Acheteurs]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des produits
 */
router.get('/liste-produits', AcheteurController.listerProduits);

/**
 * @swagger
 * /acheteurs/rechercher-produit-categorie:
 *   get:
 *     summary: Rechercher produits par nom ou catégorie
 *     tags: [Acheteurs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: recherche
 *         schema:
 *           type: string
 *         description: Nom ou catégorie du produit
 *     responses:
 *       200:
 *         description: Résultat de recherche
 */
router.get('/rechercher-produit-categorie', AcheteurController.rechercherProduits);

/**
 * @swagger
 * /acheteurs/filtrer-produit-ville:
 *   get:
 *     summary: Filtrer produits par ville
 *     tags: [Acheteurs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: ville
 *         schema:
 *           type: string
 *         example: Dakar
 *     responses:
 *       200:
 *         description: Produits filtrés
 */
router.get('/filtrer-produit-ville', AcheteurController.filtrerParVille);

/**
 * @swagger
 * /acheteurs/liste-boutiques:
 *   get:
 *     summary: Lister toutes les boutiques actives
 *     tags: [Acheteurs]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des boutiques
 */
router.get('/liste-boutiques', AcheteurController.listerBoutiques);

/**
 * @swagger
 * /acheteurs/contacter-vendeur-par-whatsapp/{id}:
 *   get:
 *     summary: Contacter un vendeur via WhatsApp
 *     tags: [Acheteurs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID du vendeur
 *     responses:
 *       200:
 *         description: Lien WhatsApp généré
 */
router.get(
  '/contacter-vendeur-par-whatsapp/:id',
  AcheteurController.contacterVendeurWhatsapp
);

/**
 * @swagger
 * /acheteurs/liste-produit-par-boutique/{boutiqueId}:
 *   get:
 *     summary: Lister les produits d'une boutique
 *     tags: [Acheteurs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: boutiqueId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la boutique
 *     responses:
 *       200:
 *         description: Produits de la boutique
 */
router.get(
  '/liste-produit-par-boutique/:boutiqueId',
  AcheteurController.getProduitsByBoutique
);

router.post('/produit/:id/vue', AcheteurController.incrementerVues);
router.get('/produit/:id', AcheteurController.getDetailProduit);
router.get('/boutique/:id', AcheteurController.getDetailBoutique);
router.get('/boutiques-proches', AcheteurController.boutiquesProches);

// -------------------- ACCUEIL --------------------
router.get('/accueil', AcheteurController.accueil);

// -------------------- TABLEAU DE BORD --------------------
router.get('/mon-tableau-de-bord', AcheteurController.monTableauDeBord);

// -------------------- FILTRES AVANCÉS --------------------
router.get('/produits', AcheteurController.listerProduitsAvecFiltres);

// -------------------- TENDANCE & DÉCOUVERTE --------------------
router.get('/decouverte', AcheteurController.decouverte);
router.get('/produits-tendance', AcheteurController.produitsTendance);
router.get('/nouvelles-boutiques', AcheteurController.nouvellesBoutiques);
router.get('/boutiques-verifiees', AcheteurController.boutiquesVerifiees);
router.get('/promotions-actives', AcheteurController.promotionsActives);

// -------------------- RECHERCHE GLOBALE --------------------
router.get('/recherche', AcheteurController.rechercheGlobale);

// -------------------- MES CONVERSATIONS --------------------
router.get('/mes-conversations', AcheteurController.mesConversations);

module.exports = router;