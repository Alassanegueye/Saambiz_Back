const express = require('express');
const router = express.Router();
const CategorieController = require('../../controllers/categories/categorie.controller');

// Catégories actives, dans l'ordre fixé depuis le dashboard admin.
router.get('/', CategorieController.getAllCategories);
// Boutiques d'une catégorie (id ou slug) — ?page, ?limit, ?latitude, ?longitude
router.get('/:id/boutiques', CategorieController.boutiquesDeCategorie);
router.get('/:id', CategorieController.getCategorieById);

module.exports = router;
