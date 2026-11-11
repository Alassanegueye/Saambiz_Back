const MessageService = require('../../services/messagerie/message.service');
const asyncHandler = require('../../middlewares/asyncHandler');
const { NotFoundError } = require('../../errors/AppError');

exports.envoyerMessage = asyncHandler(async (req, res) => {
  const result = await MessageService.envoyerMessage(req.user.id, req.body);
  if (!result.success) throw new NotFoundError(result.message);
  return res.status(201).json(result);
});

exports.getConversation = asyncHandler(async (req, res) => {
  const messages = await MessageService.getConversation(req.user.id, req.params.userId);
  return res.status(200).json({ messages });
});

exports.getConversations = asyncHandler(async (req, res) => {
  const conversations = await MessageService.getConversations(req.user.id);
  return res.status(200).json({ conversations });
});

exports.marquerLu = asyncHandler(async (req, res) => {
  const result = await MessageService.marquerLu(req.params.messageId, req.user.id);
  if (!result.success) throw new NotFoundError(result.message);
  return res.status(200).json(result);
});

exports.listerMessagesSite = asyncHandler(async (req, res) => {
  const result = await MessageService.listerMessagesSite(req.user.id, req.query);
  return res.status(200).json(result);
});

exports.marquerMessageSiteLu = asyncHandler(async (req, res) => {
  const result = await MessageService.marquerMessageSiteLu(req.params.id, req.user.id);
  if (!result.success) throw new NotFoundError(result.message);
  return res.status(200).json(result);
});

exports.supprimerMessageSite = asyncHandler(async (req, res) => {
  const result = await MessageService.supprimerMessageSite(req.params.id, req.user.id);
  if (!result.success) throw new NotFoundError(result.message);
  return res.status(200).json(result);
});

exports.getNbNonLus = asyncHandler(async (req, res) => {
  const result = await MessageService.getNbNonLus(req.user.id);
  return res.status(200).json(result);
});
