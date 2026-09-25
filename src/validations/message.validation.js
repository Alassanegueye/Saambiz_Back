const Joi = require('joi');

const envoyerMessageSchema = Joi.object({
  contenu: Joi.string().min(1).max(1000).required().messages({
    'string.min': 'Le message ne peut pas être vide',
    'string.max': 'Le message ne peut pas dépasser 1000 caractères',
    'any.required': 'Le contenu du message est requis'
  }),
  destinataireId: Joi.string().uuid().required().messages({ 'any.required': 'L\'identifiant du destinataire est requis' })
});

module.exports = { envoyerMessageSchema };
