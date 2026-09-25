const NotificationService = require('../../services/notifications/notification.service');
const asyncHandler = require('../../middlewares/asyncHandler');
const { NotFoundError } = require('../../errors/AppError');

exports.mesNotifications = asyncHandler(async (req, res) => {
  const notifications = await NotificationService.mesNotifications(req.user.id);
  return res.status(200).json({ notifications });
});

exports.marquerLue = asyncHandler(async (req, res) => {
  // Le service refuse aussi une notification appartenant à quelqu'un d'autre :
  // un 404 plutôt qu'un 403, pour ne pas confirmer qu'elle existe.
  const result = await NotificationService.marquerLue(req.params.id, req.user.id);
  if (!result.success) throw new NotFoundError(result.message);
  return res.status(200).json(result);
});

exports.marquerToutesLues = asyncHandler(async (req, res) => {
  const result = await NotificationService.marquerToutesLues(req.user.id);
  return res.status(200).json(result);
});

exports.getNbNonLues = asyncHandler(async (req, res) => {
  const result = await NotificationService.getNbNonLues(req.user.id);
  return res.status(200).json(result);
});
