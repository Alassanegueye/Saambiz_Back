const { body } = require('express-validator');

const signalementValidation = [
  body('type')
    .notEmpty().withMessage('Le type est requis')
    .isIn(['produit', 'boutique']).withMessage('Le type doit être "produit" ou "boutique"'),
  body('cibleId')
    .notEmpty().withMessage('L\'identifiant de la cible est requis')
    .isUUID().withMessage('L\'identifiant de la cible doit être un UUID valide'),
  body('raison')
    .notEmpty().withMessage('La raison est requise')
    .isString().withMessage('La raison doit être une chaîne de caractères'),
  body('description')
    .optional()
    .isString().withMessage('La description doit être une chaîne de caractères'),
];

module.exports = signalementValidation;
