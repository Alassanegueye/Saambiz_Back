const express = require('express');
const router = express.Router();
const accountController = require('../controllers/account.controller');
const auth = require('../middlewares/auth.middleware');
const checkActiveUser = require('../middlewares/checkActiveUser.middleware');
const upload = require('../middlewares/upload.middleware');
const validate = require('../middlewares/validate.middleware');
const rateLimit = require('express-rate-limit');
const { otpRateLimitConfig } = require('../config/security');

// Le code de réinitialisation part vers l'adresse indiquée dans le corps de
// la requête : c'est elle qu'il faut protéger, pas l'IP qui la demande.
const limiteOtp = rateLimit(otpRateLimitConfig);
const {
  modifierProfilSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema
} = require('../validations/account.validation');

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
router.post('/forgot-password', limiteOtp, validate(forgotPasswordSchema), accountController.forgotPassword);
router.post('/reset-password', limiteOtp, validate(resetPasswordSchema), accountController.resetPassword);

module.exports = router;
