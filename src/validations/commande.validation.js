const Joi = require('joi');

const creerCommandeSchema = Joi.object({
  items: Joi.array().items(
    Joi.object({
      produitId: Joi.string().required().messages({ 'any.required': 'produitId est requis' }),
      quantite: Joi.number().integer().min(1).required().messages({
        'number.min': 'La quantité doit être au moins 1',
        'any.required': 'La quantité est requise',
      }),
      // Options choisies (taille, parfum, format…) : { libellé: valeur }.
      options: Joi.object().pattern(Joi.string().max(40), Joi.string().max(80).allow('')).max(10).optional().allow(null),
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

// Commande saisie par le vendeur lui-même (prise par téléphone, WhatsApp,
// en boutique…) : le client n'a pas forcément de compte, ses coordonnées
// voyagent avec la commande.
const creerCommandeVendeurSchema = Joi.object({
  client: Joi.object({
    prenom: Joi.string().trim().min(2).max(120).required().messages({
      'any.required': 'Le prénom du client est requis',
      'string.empty': 'Le prénom du client est requis',
      'string.min': 'Le prénom du client est trop court',
    }),
    nom: Joi.string().trim().max(120).optional().allow('', null),
    telephone: Joi.string().trim().required().messages({
      'any.required': 'Le téléphone du client est requis',
      'string.empty': 'Le téléphone du client est requis',
    }),
    email: Joi.string().trim().email().optional().allow('', null),
  }).required().messages({ 'any.required': 'Les coordonnées du client sont requises' }),
  items: Joi.array().items(
    Joi.object({
      produitId: Joi.string().required(),
      quantite: Joi.number().integer().min(1).required(),
      options: Joi.object().pattern(Joi.string().max(40), Joi.string().max(80).allow('')).max(10).optional().allow(null),
    })
  ).min(1).max(30).required().messages({
    'array.min': 'Ajoutez au moins un produit',
    'any.required': 'Ajoutez au moins un produit',
  }),
  modeLivraison: Joi.string().valid('livraison', 'retrait').optional(),
  adresseLivraison: Joi.string().max(240).optional().allow('', null),
  note: Joi.string().max(500).optional().allow('', null),
}).unknown(true);

const payerCommandeSchema = Joi.object({
  methode: Joi.string().valid('orange_money', 'wave').required().messages({
    'any.required': 'La méthode de paiement est requise',
  }),
  numeroTelephone: Joi.string().optional().allow('', null),
}).unknown(true);

const changerStatutSchema = Joi.object({
  statut: Joi.string()
    .valid('acceptee', 'rejetee', 'confirmee', 'en_preparation', 'prete', 'en_livraison', 'livree', 'annulee')
    .required()
    .messages({ 'any.required': 'Le nouveau statut est requis' }),
}).unknown(true);

module.exports = { creerCommandeSchema, creerCommandeVendeurSchema, payerCommandeSchema, changerStatutSchema };
