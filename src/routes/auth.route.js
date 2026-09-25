const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { changerMotDePasse } = require('../controllers/authPassword.controller');
const upload = require('../middlewares/upload.middleware');
const authMiddleware = require('../middlewares/auth.middleware');
const validate = require('../middlewares/validate.middleware');
const {
  registerSchema,
  loginSchema,
  envoyerCodeInscriptionSchema,
  verifierCodeInscriptionSchema,
} = require('../validators/auth.validator');
const rateLimit = require('express-rate-limit');
const { otpRateLimitConfig } = require('../config/security');

// Envoi de code : compté sur l'adresse VISÉE, pas sur l'IP de l'appelant.
// Sinon un attaquant qui fait tourner ses IP pilonne la boîte mail d'une
// victime sans jamais déclencher la limite globale.
const limiteOtp = rateLimit(otpRateLimitConfig);

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Gestion authentification
 */

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Inscription utilisateur (Acheteur ou Vendeur)
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               nom:
 *                 type: string
 *               prenom:
 *                 type: string
 *               email:
 *                 type: string
 *               mot_de_passe:
 *                 type: string
 *               adresse:
 *                 type: string
 *               telephone:
 *                 type: string
 *               role:
 *                 type: string
 *                 example: Vendeur
 *               nomBoutique:
 *                 type: string
 *               description:
 *                 type: string
 *               localisation:
 *                 type: string
 *               categorie:
 *                 type: string
 *               slogan:
 *                 type: string
 *               telephoneBoutique:
 *                 type: string
 *               photoProfil:
 *                 type: string
 *                 format: binary
 *               logo:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Inscription réussie
 *       400:
 *         description: Erreur validation
 */
router.post(
  '/register',
  upload.fields([
    { name: 'photoProfil', maxCount: 1 },
    { name: 'logo', maxCount: 1 },
  ]),
  upload.verifyMagicBytes,
  validate(registerSchema),
  authController.inscriptionUser
);

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Connexion utilisateur faut choisir entre email ou telephone
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 example: test@gmail.com
 *               telephone:
 *                 type: string
 *                 example: "+221770000000"
 *               mot_de_passe:
 *                 type: string
 *                 example: 123456
 *     responses:
 *       200:
 *         description: Connexion réussie
 *       400:
 *         description: Identifiant incorrect
 */
/**
 * @swagger
 * /auth/inscription/envoyer-code:
 *   post:
 *     summary: Envoyer un code de vérification à une adresse email
 *     description: >
 *       Première étape de l'inscription. Aucun compte n'est créé : seule une
 *       vérification éphémère est enregistrée. Le compte ne naîtra qu'une fois
 *       le code validé.
 *     tags: [Auth]
 *     responses:
 *       200: { description: Code envoyé }
 *       409: { description: Adresse déjà associée à un compte }
 *       429: { description: Code déjà envoyé il y a moins de 30 secondes }
 */
router.post(
  '/inscription/envoyer-code',
  limiteOtp,
  validate(envoyerCodeInscriptionSchema),
  authController.envoyerCodeInscription
);

/**
 * @swagger
 * /auth/inscription/verifier-code:
 *   post:
 *     summary: Valider le code et obtenir le jeton d'inscription
 *     tags: [Auth]
 *     responses:
 *       200: { description: Jeton à présenter à /auth/register }
 *       400: { description: Code incorrect ou expiré }
 *       429: { description: Trop d'essais infructueux }
 */
router.post(
  '/inscription/verifier-code',
  limiteOtp,
  validate(verifierCodeInscriptionSchema),
  authController.verifierCodeInscription
);

router.post('/login', validate(loginSchema), authController.login);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Déconnexion
 *     description: >
 *       Met le jeton d'accès en liste noire jusqu'à son expiration naturelle
 *       et révoque le jeton de rafraîchissement transmis. Sans ce dernier, la
 *       session pourrait se reconstituer aussitôt.
 *     tags: [Authentification]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 description: Jeton de rafraîchissement à révoquer
 *     responses:
 *       200: { description: Déconnexion effectuée }
 *       401: { $ref: '#/components/responses/NonAuthentifie' }
 */
router.post('/logout', authMiddleware, authController.logout);

/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     summary: Prolonger la session
 *     description: >
 *       Émet un nouveau jeton d'accès **et** un nouveau jeton de
 *       rafraîchissement. L'ancien refresh est révoqué : il ne sert qu'une
 *       fois. Présenté deux fois, la seconde tentative échoue — ce qui rend un
 *       vol visible au lieu de le laisser passer inaperçu. Le client doit donc
 *       remplacer les deux jetons qu'il conserve.
 *     tags: [Authentification]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken: { type: string }
 *     responses:
 *       200:
 *         description: Session prolongée
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token: { type: string, description: "Nouveau jeton d'accès (1 h)" }
 *                 refreshToken: { type: string, description: 'Nouveau jeton de rafraîchissement (7 j)' }
 *       401:
 *         description: Jeton absent de la base, révoqué ou expiré
 */
router.post('/refresh', authController.refresh);

// MED-03 : vérification email — GET depuis le lien reçu par email,
// POST { email, code } depuis l'application mobile.
router.get('/verify-email', authController.verifierEmail);

/**
 * @swagger
 * /auth/verify-email:
 *   post:
 *     summary: Vérifier une adresse email avec le code reçu
 *     tags: [Authentification]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, code]
 *             properties:
 *               email: { type: string, format: email }
 *               code:  { type: string, example: '482913', description: 'Code à 6 chiffres reçu par email' }
 *     responses:
 *       200: { description: Adresse vérifiée }
 *       400: { description: Code expiré ou invalide }
 *       429: { $ref: '#/components/responses/TropDeRequetes' }
 */
router.post('/verify-email', limiteOtp, authController.verifierEmail);

// Renvoi d'un nouveau code de vérification — POST { email }
/**
 * @swagger
 * /auth/resend-verification:
 *   post:
 *     summary: Renvoyer un code de vérification
 *     description: >
 *       Limité à 5 envois par quart d'heure **et par adresse visée**, non par
 *       IP : sinon un attaquant qui fait tourner ses adresses pilonne la boîte
 *       mail d'une victime sans jamais déclencher la limite.
 *     tags: [Authentification]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *     responses:
 *       200: { description: Code envoyé }
 *       429: { $ref: '#/components/responses/TropDeRequetes' }
 */
router.post('/resend-verification', limiteOtp, authController.renvoyerCodeVerification);

// RBAC : changement de mot de passe (première connexion ou volontaire)
router.post('/changer-mot-de-passe', authMiddleware, changerMotDePasse);

module.exports = router;