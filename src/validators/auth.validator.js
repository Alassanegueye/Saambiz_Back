const Joi = require('joi');

// MED-02 : politique de mot de passe renforcée (8 chars + majuscule + chiffre + caractère spécial)
// Architecture : passwordSchema partagé importé ici et dans account.validation.js
const passwordSchema = Joi.string()
  .min(8)
  .pattern(/[A-Z]/, 'au moins une majuscule')
  .pattern(/[0-9]/, 'au moins un chiffre')
  .pattern(/[^A-Za-z0-9]/, 'au moins un caractère spécial')
  .required()
  .messages({
    'string.min':          'Le mot de passe doit contenir au moins 8 caractères.',
    'string.pattern.name': 'Le mot de passe doit contenir {#name}.',
    'any.required':        'Le mot de passe est requis.',
  });

exports.passwordSchema = passwordSchema;

// ─── Vérification de l'adresse, avant l'inscription ────────────────────────
exports.envoyerCodeInscriptionSchema = Joi.object({
  email: Joi.string().email().required().messages({
    'string.email':  'Adresse email invalide.',
    'any.required':  "L'adresse email est obligatoire.",
  }),
  // Sert uniquement à personnaliser le message : « Bonjour Alassane ».
  prenom: Joi.string().max(100).optional().allow(''),
}).options({ allowUnknown: false });

exports.verifierCodeInscriptionSchema = Joi.object({
  email: Joi.string().email().required(),
  code: Joi.string().pattern(/^[0-9]{6}$/).required().messages({
    'string.pattern.base': 'Le code comporte 6 chiffres.',
    'any.required':        'Saisissez le code reçu par email.',
  }),
}).options({ allowUnknown: false });

exports.registerSchema = Joi.object({
  nom:      Joi.string().min(2).max(100).required(),
  prenom:   Joi.string().min(2).max(100).required(),
  email:    Joi.string().email().required(),
  mot_de_passe: passwordSchema,
  // L'inscription mobile se fait à l'email (code de vérification envoyé par
  // mail) : le téléphone devient facultatif et reste utile pour le contact.
  telephone: Joi.string().pattern(/^\+?[0-9]{7,15}$/).optional().allow('', null)
    .messages({ 'string.pattern.base': 'Téléphone invalide (7-15 chiffres, + autorisé).' }),
  adresse:  Joi.string().max(255).optional().allow(''),
  role:     Joi.string().valid('Vendeur', 'Acheteur').required(),
  // Remis par /auth/inscription/verifier-code. Sans lui, pas de compte :
  // l'adresse doit avoir été confirmée AVANT la création, pas après.
  jetonEmail: Joi.string().length(64).hex().required().messages({
    'any.required': 'Vérifiez votre adresse email avant de créer votre compte.',
    'string.length': 'Vérification invalide. Recommencez avec un nouveau code.',
    'string.hex':    'Vérification invalide. Recommencez avec un nouveau code.',
  }),
  // Champs boutique (Vendeur uniquement)
  nomBoutique:      Joi.string().max(150).optional().allow(''),
  description:      Joi.string().max(1000).optional().allow(''),
  slogan:           Joi.string().max(255).optional().allow(''),
  localisation:     Joi.string().max(255).optional().allow(''),
  categorie:        Joi.string().max(100).optional().allow(''),
  telephoneBoutique: Joi.string().optional().allow(''),
}).options({ allowUnknown: false });

exports.loginSchema = Joi.object({
  email:       Joi.string().email().optional(),
  telephone:   Joi.string().optional(),
  mot_de_passe: Joi.string().required(),
})
  .or('email', 'telephone')
  .messages({ 'object.missing': 'Email ou téléphone est requis.' })
  .options({ allowUnknown: false });
