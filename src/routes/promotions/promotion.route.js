const express = require('express');
const router = express.Router();
const promotionController = require('../../controllers/promotions/promotion.controller');
const auth = require('../../middlewares/auth.middleware');
const checkActiveUser = require('../../middlewares/checkActiveUser.middleware');
const isVendeur = require('../../middlewares/isVendeur.middleware');
const finAbonnement = require('../../middlewares/finAbonnement.middleware');
const validate = require('../../middlewares/validate.middleware');
const { creerPromotionSchema, modifierPromotionSchema } = require('../../validations/promotion.validation');

// Route publique
router.get('/actives', promotionController.getPromotionsActives);

// Routes vendeur
router.post('/', auth, checkActiveUser, isVendeur, finAbonnement, validate(creerPromotionSchema), promotionController.creerPromotion);
router.put('/:id', auth, checkActiveUser, isVendeur, finAbonnement, validate(modifierPromotionSchema), promotionController.modifierPromotion);
router.delete('/:id', auth, checkActiveUser, isVendeur, promotionController.supprimerPromotion);
router.get('/', auth, checkActiveUser, isVendeur, promotionController.mesPromotions);

module.exports = router;
