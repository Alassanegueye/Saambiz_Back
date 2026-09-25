const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const VitrineController = require('../../controllers/vitrine/vitrine.controller');

/**
 * @swagger
 * tags:
 *   name: Vitrine
 *   description: Site public d'une boutique — accessible sans compte
 */

// ═══════════════════════════════════════════════════════════════════════
//  Aucun middleware d'authentification ici, et c'est délibéré.
//
//  Le visiteur est un client du vendeur, arrivé par un lien WhatsApp ou un
//  QR code collé sur une devanture. Lui demander un compte avant de voir le
//  catalogue, c'est perdre la vente. Le compte se propose APRÈS, en bas du
//  site, pour suivre la boutique et recevoir ses notifications.
//
//  En contrepartie, tout ce que renvoient ces routes passe par les listes
//  d'attributs explicites de VitrineService — rien ne sort par accident.
// ═══════════════════════════════════════════════════════════════════════

/**
 * Le passage en caisse crée une ligne utilisateur et une commande : c'est la
 * seule écriture ouverte au public, donc la seule qui mérite son propre
 * plafond.
 *
 * Dix commandes par quart d'heure et par adresse : de quoi laisser passer
 * une famille qui commande depuis la même connexion — le cas est courant à
 * Dakar, où l'on partage un cybercafé ou un partage de connexion — tout en
 * arrêtant un script qui remplirait la table de commandes.
 */
const limiteCommande = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.VITRINE_COMMANDE_RATE_LIMIT_MAX) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Trop de commandes depuis cette connexion. Réessayez dans quelques minutes.',
  },
});

/**
 * Le suivi se consulte par référence + téléphone. Sans plafond, la paire
 * s'énumère : on plafonne les essais, pas les consultations légitimes.
 */
const limiteSuivi = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.VITRINE_SUIVI_RATE_LIMIT_MAX) || 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Trop de recherches. Réessayez dans quelques minutes.',
  },
});

/**
 * @swagger
 * /vitrine/commande/{reference}:
 *   get:
 *     summary: Suivre une commande sans compte (référence + téléphone)
 *     tags: [Vitrine]
 *     parameters:
 *       - in: path
 *         name: reference
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: telephone
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Commande retrouvée }
 *       404: { description: Aucune commande ne correspond }
 */
// Déclarée avant `/:slug` : sans cela, « commande » serait pris pour un slug.
router.get('/commande/:reference', limiteSuivi, VitrineController.suivreCommande);

/**
 * @swagger
 * /vitrine/{slug}:
 *   get:
 *     summary: Page d'accueil du site d'une boutique
 *     tags: [Vitrine]
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Boutique, thème, catégories, produits et avis }
 *       404: { description: Boutique inexistante ou hors ligne }
 */
router.get('/:slug', VitrineController.accueil);

/**
 * @swagger
 * /vitrine/{slug}/produits:
 *   get:
 *     summary: Catalogue de la boutique (recherche, filtre, tri, pagination)
 *     tags: [Vitrine]
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *       - in: query
 *         name: categorie
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: tri
 *         schema: { type: string, enum: [pertinence, nouveaute, prix_asc, prix_desc, populaire] }
 *     responses:
 *       200: { description: Produits paginés }
 */
router.get('/:slug/produits', VitrineController.listerProduits);

/**
 * @swagger
 * /vitrine/{slug}/produits/{produitId}:
 *   get:
 *     summary: Fiche d'un produit de la boutique
 *     tags: [Vitrine]
 *     responses:
 *       200: { description: Produit, boutique et produits similaires }
 *       404: { description: Produit inexistant dans cette boutique }
 */
router.get('/:slug/produits/:produitId', VitrineController.getProduit);

/**
 * @swagger
 * /vitrine/{slug}/commande:
 *   post:
 *     summary: Commander sans compte depuis le site de la boutique
 *     tags: [Vitrine]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               client:
 *                 type: object
 *                 properties:
 *                   nom:       { type: string }
 *                   prenom:    { type: string }
 *                   telephone: { type: string }
 *                   email:     { type: string }
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     produitId: { type: string, format: uuid }
 *                     quantite:  { type: integer }
 *               modeLivraison:    { type: string, enum: [livraison, retrait] }
 *               modePaiement:     { type: string, enum: [a_la_livraison, en_ligne] }
 *               adresseLivraison: { type: string }
 *               note:             { type: string }
 *     responses:
 *       201: { description: Commande enregistrée, référence de suivi renvoyée }
 *       400: { description: Panier vide, stock insuffisant ou numéro invalide }
 */
router.post('/:slug/commande', limiteCommande, VitrineController.creerCommande);

module.exports = router;
