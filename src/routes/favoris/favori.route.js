const express = require('express');
const router = express.Router();
const favoriController = require('../../controllers/favoris/favori.controller');
const auth = require('../../middlewares/auth.middleware');
const checkActiveUser = require('../../middlewares/checkActiveUser.middleware');
const isAcheteur = require('../../middlewares/isAcheteur.middleware');

router.use(auth);
router.use(checkActiveUser);
router.use(isAcheteur);

router.post('/', favoriController.ajouterFavori);            // suivre une boutique
router.get('/', favoriController.mesFavoris);               // mes boutiques suivies
router.get('/:boutiqueId/statut', favoriController.statutSuivi);   // suis-je abonné ? cloche ?
router.patch('/:boutiqueId/cloche', favoriController.toggleCloche); // 🔔 activer/désactiver la cloche
router.delete('/:boutiqueId', favoriController.supprimerFavori);   // ne plus suivre

module.exports = router;
