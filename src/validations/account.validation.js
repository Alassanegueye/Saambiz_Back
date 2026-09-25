const Joi = require('joi');
// MED-02 / Architecture : passwordSchema centralisé dans auth.validator.js
const { passwordSchema } = require('../validators/auth.validator');

const modifierProfilSchema = Joi.object({
  nom: Joi.string().optional(),
  prenom: Joi.string().optional(),
  email: Joi.string().email().optional().messages({ 'string.email': 'Email invalide' }),
  telephone: Joi.string().optional().allow('', null),
  adresse: Joi.string().optional().allow('', null),
  ville: Joi.string().optional().allow('', null)
}).unknown(true);

const changePasswordSchema = Joi.object({
  ancienMotDePasse: Joi.string().required().messages({ 'any.required': 'L\'ancien mot de passe est requis' }),
  nouveauMotDePasse: passwordSchema
});

const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().required().messages({ 'string.email': 'Email invalide', 'any.required': 'L\'email est requis' })
});

const resetPasswordSchema = Joi.object({
  email: Joi.string().email().required().messages({ 'string.email': 'Email invalide', 'any.required': 'L\'email est requis' }),
  otp: Joi.string().required().messages({ 'any.required': 'Le code OTP est requis' }),
  nouveauMotDePasse: passwordSchema
});

module.exports = { modifierProfilSchema, changePasswordSchema, forgotPasswordSchema, resetPasswordSchema };
