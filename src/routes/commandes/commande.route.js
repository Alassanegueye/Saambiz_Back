// routes/commandes/commande.route.js
const express = require('express');
const router = express.Router();
const CommandeController = require('../../controllers/commandes/commande.controller');
const authMiddleware = require('../../middlewares/auth.middleware');
const checkActiveUser = require('../../middlewares/checkActiveUser.middleware');
const isAcheteur = require('../../middlewares/isAcheteur.middleware');
const isVendeur = require('../../middlewares/isVendeur.middleware');
const validate = require('../../middlewares/validate.middleware');
const {
  creerCommandeSchema,
  payerCommandeSchema,
  changerStatutSchema,
} = require('../../validations/commande.validation');
const { creerDemandeRetourSchema } = require('../../validations/demandeRetour.validation');

// Toutes les routes nécessitent un utilisateur authentifié et actif
router.use(authMiddleware);
router.use(checkActiveUser);

/**
 * @swagger
 * tags:
 *   name: Commandes
 *   description: Gestion des commandes (achat/vente en ligne)
 */

// ================================================================
//  VENDEUR — défini AVANT /:id pour éviter la collision de route
// ================================================================

// Commandes reçues par le vendeur connecté
router.get('/vendeur', isVendeur, CommandeController.commandesVendeur);

// Faire avancer le statut d'une commande (vendeur)
router.patch('/:id/statut', isVendeur, validate(changerStatutSchema), CommandeController.changerStatut);

// ================================================================
//  ACHETEUR
// ================================================================

// Créer une commande
router.post('/', isAcheteur, validate(creerCommandeSchema), CommandeController.creerCommande);

// Mes commandes
router.get('/', isAcheteur, CommandeController.mesCommandes);

// Payer une commande en ligne
router.post('/:id/payer', isAcheteur, validate(payerCommandeSchema), CommandeController.payerCommande);

// Annuler une commande
router.put('/:id/annuler', isAcheteur, CommandeController.annulerCommande);

// ================================================================
//  COMMUN (acheteur propriétaire OU vendeur concerné)
// ================================================================

// Détail d'une commande (l'accès est vérifié dans le service)
router.get('/:id', CommandeController.getCommande);

// ================================================================
//  RETOUR / REMBOURSEMENT (acheteur)
// ================================================================

// Demander un retour/remboursement sur une commande livrée
router.post('/:id/demande-retour', isAcheteur, validate(creerDemandeRetourSchema), CommandeController.demanderRetour);

module.exports = router;
