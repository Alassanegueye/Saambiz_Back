const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const SitesController = require('../../controllers/sites/sites.controller');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Sites
 *   description: Fréquentation et formulaire de contact des sites vitrines (kodafrik.com, saambiz.com)
 */

// ═══════════════════════════════════════════════════════════════════════
//  Ouvert au public, comme la vitrine des boutiques : le visiteur d'un site
//  n'a pas de compte. Monté avant le limiteur par compte (voir app.js).
//
//  Le site envoie ses événements par navigator.sendBeacon, en texte brut :
//  c'est un type « simple » pour le navigateur, sans requête préalable
//  (OPTIONS), donc rien à attendre ni à perdre quand l'onglet se ferme.
// ═══════════════════════════════════════════════════════════════════════

const cleIp = (req) => ipKeyGenerator(req.ip);

/** Large : une visite envoie une page vue, un temps passé et des clics par page. */
const limiteSuivi = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.SITE_SUIVI_RATE_LIMIT_MAX) || 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `site-suivi:${cleIp(req)}`,
  // Un navigateur n'a rien à lire : 204 plutôt qu'un message.
  handler: (_req, res) => res.status(204).end(),
});

/** Comme l'ancien envoi.php : cinq demandes par adresse sur dix minutes. */
const limiteMessage = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.SITE_MESSAGE_RATE_LIMIT_MAX) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `site-message:${cleIp(req)}`,
  message: { success: false, message: 'Trop de demandes envoyées. Réessayez dans quelques minutes.' },
});

const texteBrut = express.text({ type: ['text/plain', 'text/*'], limit: '8kb' });

/**
 * @swagger
 * /sites/{site}/evenements:
 *   post:
 *     summary: Une page vue, un temps passé ou un clic sur un site vitrine
 *     tags: [Sites]
 *     parameters:
 *       - in: path
 *         name: site
 *         required: true
 *         schema: { type: string, enum: [kodafrik, saambiz] }
 *     responses:
 *       204: { description: Reçu (compté ou écarté) }
 */
router.post('/:site/evenements', limiteSuivi, texteBrut, SitesController.suivre);

/**
 * @swagger
 * /sites/{site}/messages:
 *   post:
 *     summary: Demande envoyée par le formulaire de contact du site
 *     tags: [Sites]
 *     responses:
 *       201: { description: Demande enregistrée et transmise }
 *       422: { description: Champ invalide }
 *       429: { description: Trop de demandes depuis cette adresse }
 */
router.post('/:site/messages', limiteMessage, SitesController.recevoirMessage);

module.exports = router;
