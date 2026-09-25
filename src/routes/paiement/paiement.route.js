// routes/paiement/paiement.routes.js
const express = require('express');
const router = express.Router();
const PaiementController = require('../../controllers/paiement/paiement.controller');
const authMiddleware = require('../../middlewares/auth.middleware');
const checkActiveUser = require('../../middlewares/checkActiveUser.middleware');
const isVendeur = require('../../middlewares/isVendeur.middleware');

// ================================================================
//  ROUTES PUBLIQUES — pas de JWT (Orange Money appelle directement)
// ================================================================
router.post('/webhook/orange', PaiementController.webhook);

// ================================================================
//  ROUTES PROTEGEES — JWT + utilisateur actif + vendeur
// ================================================================
router.use(authMiddleware);
router.use(checkActiveUser);
router.use(isVendeur);

// Initier un paiement Orange Money (ou Wave)
router.post('/payer', PaiementController.payer);

// Consulter un paiement par son ID
router.get('/:paiementId', PaiementController.getPaiement);

// Historique des paiements de l'utilisateur connecté
router.get('/', PaiementController.getHistorique);

module.exports = router;