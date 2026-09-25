const express = require('express');
const router = express.Router();
const CategorieController = require('../../controllers/categories/categorie.controller');

router.get('/', CategorieController.getAllCategories);
router.get('/:id', CategorieController.getCategorieById);

module.exports = router;
