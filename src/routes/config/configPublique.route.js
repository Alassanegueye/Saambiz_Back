const express = require('express');
const ConfigPubliqueController = require('../../controllers/config/configPublique.controller');

// Réglages publics, sans authentification — voir le contrôleur pour la
// raison des réponses par défaut en cas d'échec.
const router = express.Router();

router.get('/prix-abonnement', ConfigPubliqueController.getPrixAbonnement);
router.get('/app/config', ConfigPubliqueController.getConfigApplication);

module.exports = router;
