const Joi = require('joi');

const creerCommandeSchema = Joi.object({
  items: Joi.array().items(
    Joi.object({
      produitId: Joi.string().required().messages({ 'any.required': 'produitId est requis' }),
      quantite: Joi.number().integer().min(1).required().messages({
        'number.min': 'La quantité doit être au moins 1',
        'any.required': 'La quantité est requise',
      }),
    })
  ).min(1).required().messages({
    'array.min': 'La commande doit contenir au moins un article',
    'any.required': 'La liste des articles est requise',
  }),
  modeLivraison: Joi.string().valid('livraison', 'retrait').optional(),
  modePaiement: Joi.string().valid('en_ligne', 'a_la_livraison').optional(),
  adresseLivraison: Joi.string().optional().allow('', null),
  numeroTelephone: Joi.string().optional().allow('', null),
  note: Joi.string().optional().allow('', null),
}).unknown(true);

const payerCommandeSchema = Joi.object({
  methode: Joi.string().valid('orange_money', 'wave').required().messages({
    'any.required': 'La méthode de paiement est requise',
  }),
  numeroTelephone: Joi.string().optional().allow('', null),
}).unknown(true);

const changerStatutSchema = Joi.object({
  statut: Joi.string()
    .valid('confirmee', 'en_preparation', 'prete', 'en_livraison', 'livree', 'annulee')
    .required()
    .messages({ 'any.required': 'Le nouveau statut est requis' }),
}).unknown(true);

module.exports = { creerCommandeSchema, payerCommandeSchema, changerStatutSchema };
