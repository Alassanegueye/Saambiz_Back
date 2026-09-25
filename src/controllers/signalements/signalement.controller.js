const { validationResult } = require('express-validator');
const SignalementService = require('../../services/signalements/signalement.service');
const asyncHandler = require('../../middlewares/asyncHandler');
const { ValidationError, NotFoundError } = require('../../errors/AppError');

class SignalementController {

  static signalerContenu = asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError('Certaines informations sont invalides.', errors.array());
    }

    const signaleurId = req.user.id;
    const { type, cibleId, raison, description } = req.body;

    // La cible peut avoir disparu entre l'affichage et le signalement.
    const result = await SignalementService
      .signalerContenu(signaleurId, { type, cibleId, raison, description })
      .catch((err) => {
        if (err.message.includes('introuvable')) throw new NotFoundError(err.message);
        throw err;
      });

    return res.status(201).json({ success: true, ...result });
  });

  static mesSignalements = asyncHandler(async (req, res) => {
    const result = await SignalementService.mesSignalements(req.user.id);
    return res.status(200).json({ success: true, ...result });
  });
}

module.exports = SignalementController;
