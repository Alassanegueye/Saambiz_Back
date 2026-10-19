const express = require('express');
const router = express.Router();
const authOptionnel = require('../../middlewares/authOptionnel.middleware');
const CatalogueController = require('../../controllers/catalogue/catalogue.controller');

// Catalogue public : un visiteur qui a choisi « continuer sans compte » doit
// pouvoir tout parcourir. Le compte n'est demandé qu'au moment de commander.
router.use(authOptionnel);

// ?categorie=<id|slug> &boutique=<id> &q= &tri=recents|populaires|prix_asc|prix_desc|promos &promo=1 &page= &limit=
router.get('/produits', CatalogueController.lister);
router.get('/produits/:id', CatalogueController.detail);
router.get('/promotions', CatalogueController.promotions);
router.get('/boutiques/:id', CatalogueController.boutique);

module.exports = router;
