const Joi = require('joi');

const creerDemandeRetourSchema = Joi.object({
  raison: Joi.string().min(3).max(1000).required().messages({
    'string.min': 'La raison doit contenir au moins 3 caractères',
    'string.max': 'La raison ne peut pas dépasser 1000 caractères',
    'any.required': 'La raison est requise',
  }),
}).unknown(true);

const traiterDemandeRetourSchema = Joi.object({
  action: Joi.string().valid('accepter', 'refuser').required().messages({
    'any.only': "L'action doit être 'accepter' ou 'refuser'",
    'any.required': "L'action est requise",
  }),
  reponseAdmin: Joi.string().optional().allow('', null),
}).unknown(true);

module.exports = { creerDemandeRetourSchema, traiterDemandeRetourSchema };
