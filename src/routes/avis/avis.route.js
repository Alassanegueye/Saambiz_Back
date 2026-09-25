const express = require('express');
const router = express.Router();
const avisController = require('../../controllers/avis/avis.controller');
const auth = require('../../middlewares/auth.middleware');
const checkActiveUser = require('../../middlewares/checkActiveUser.middleware');
const isAcheteur = require('../../middlewares/isAcheteur.middleware');

// ── Public : consulter les avis et la note d'une boutique ──
router.get('/boutique/:boutiqueId', avisController.avisBoutique);

// ── Acheteur authentifié ──
router.post('/', auth, checkActiveUser, isAcheteur, avisController.laisserAvis);
router.get('/boutique/:boutiqueId/mon-avis', auth, checkActiveUser, isAcheteur, avisController.monAvis);
router.delete('/boutique/:boutiqueId', auth, checkActiveUser, isAcheteur, avisController.supprimerAvis);

module.exports = router;
