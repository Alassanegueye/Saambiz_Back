const express = require('express');
const router = express.Router();
const accountController = require('../controllers/account.controller');
const auth = require('../middlewares/auth.middleware');
const checkActiveUser = require('../middlewares/checkActiveUser.middleware');
const upload = require('../middlewares/upload.middleware');
const validate = require('../middlewares/validate.middleware');
const rateLimit = require('express-rate-limit');
const { otpRateLimitConfig, otpVerificationRateLimitConfig } = require('../config/security');

// Le code de réinitialisation part vers l'adresse indiquée dans le corps de
// la requête : c'est elle qu'il faut protéger, pas l'IP qui la demande.
const limiteEnvoiCode = rateLimit(otpRateLimitConfig);
const limiteSaisieCode = rateLimit(otpVerificationRateLimitConfig);
const {
  modifierProfilSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema
} = require('../validations/account.validation');

// Mot de passe oublie : celui qui le demande n'est, par definition, pas
// connecte. Ces deux routes doivent rester AVANT router.use(auth) ;
// declarees apres, le middleware les rejette par « Token manquant ou
// invalide » sans jamais atteindre le controleur. Ni l'une ni l'autre ne
// lit req.user : tout vient du corps de la requete (email, otp).
router.post('/forgot-password', limiteEnvoiCode, validate(forgotPasswordSchema), accountController.forgotPassword);
router.post('/reset-password', limiteSaisieCode, validate(resetPasswordSchema), accountController.resetPassword);

router.use(auth);
router.use(checkActiveUser);

router.get('/me', accountController.me);
router.delete('/me', accountController.deleteAccount);
router.put('/modifier-profil',
  upload.single('photoProfil'),
  upload.verifyMagicBytes,
  validate(modifierProfilSchema),
  accountController.updateProfile);
router.put('/change-password', validate(changePasswordSchema), accountController.changePassword);

module.exports = router;
