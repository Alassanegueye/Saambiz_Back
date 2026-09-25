const Joi = require('joi');

const creerPromotionSchema = Joi.object({
  titre: Joi.string().required().messages({ 'any.required': 'Le titre est requis' }),
  description: Joi.string().optional().allow('', null),
  // On accepte soit un prix promo absolu, soit un pourcentage de rabais (au moins l'un des deux)
  prixPromo: Joi.number().positive().optional().messages({ 'number.positive': 'Le prix promotionnel doit être positif' }),
  pourcentage: Joi.number().min(1).max(99).optional().messages({ 'number.min': 'Le rabais doit être entre 1 et 99 %', 'number.max': 'Le rabais doit être entre 1 et 99 %' }),
  produitId: Joi.string().uuid().required().messages({ 'any.required': 'L\'identifiant du produit est requis' }),
  dateDebut: Joi.date().required().messages({ 'any.required': 'La date de début est requise' }),
  dateFin: Joi.date().required().messages({ 'any.required': 'La date de fin est requise' })
}).or('prixPromo', 'pourcentage').messages({ 'object.missing': 'Indiquez un prix promo ou un pourcentage de rabais' });

const modifierPromotionSchema = Joi.object({
  titre: Joi.string().optional(),
  description: Joi.string().optional().allow('', null),
  prixPromo: Joi.number().positive().optional(),
  pourcentage: Joi.number().min(1).max(99).optional(),
  produitId: Joi.string().uuid().optional(),
  dateDebut: Joi.date().optional(),
  dateFin: Joi.date().optional()
});

module.exports = { creerPromotionSchema, modifierPromotionSchema };
