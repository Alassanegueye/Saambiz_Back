const CentreAideService = require('../../services/config/centreAide.service');
const AuditService = require('../../services/audit.service');
const asyncHandler = require('../../middlewares/asyncHandler');

/** Centre d'aide de l'application (dashboard admin → Configuration). */

exports.lire = asyncHandler(async (req, res) => {
  const [contacts, questions] = await Promise.all([
    CentreAideService.contacts(),
    CentreAideService.questions({ toutes: true }),
  ]);
  return res.status(200).json({ contacts, questions });
});

exports.modifierContacts = asyncHandler(async (req, res) => {
  const contacts = await CentreAideService.modifierContacts(req.body, req.user.id);
  AuditService.enregistrer({ adminId: req.user.id, action: 'modifier_contacts_aide', cible: 'config', cibleId: 'centre_aide', details: contacts }).catch(() => {});
  return res.status(200).json({ message: 'Coordonnées enregistrées', contacts });
});

exports.ajouterQuestion = asyncHandler(async (req, res) => {
  const question = await CentreAideService.ajouterQuestion(req.body);
  return res.status(201).json({ message: 'Question ajoutée', question });
});

exports.modifierQuestion = asyncHandler(async (req, res) => {
  const question = await CentreAideService.modifierQuestion(req.params.id, req.body);
  return res.status(200).json({ message: 'Question modifiée', question });
});

exports.supprimerQuestion = asyncHandler(async (req, res) => {
  await CentreAideService.supprimerQuestion(req.params.id);
  return res.status(200).json({ message: 'Question supprimée' });
});

exports.ordonner = asyncHandler(async (req, res) => {
  const questions = await CentreAideService.ordonner(req.body?.ids);
  return res.status(200).json({ message: 'Ordre enregistré', questions });
});
