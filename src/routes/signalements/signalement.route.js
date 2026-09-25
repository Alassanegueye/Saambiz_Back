const express = require('express');
const router = express.Router();
const SignalementController = require('../../controllers/signalements/signalement.controller');
const authMiddleware = require('../../middlewares/auth.middleware');
const isAcheteur = require('../../middlewares/isAcheteur.middleware');
const signalementValidation = require('../../validations/signalement.validation');

router.post(
  '/',
  authMiddleware,
  isAcheteur,
  signalementValidation,
  SignalementController.signalerContenu
);

router.get(
  '/mes-signalements',
  authMiddleware,
  SignalementController.mesSignalements
);

module.exports = router;
