const ConfigService = require('../../services/config/config.service');
const AuditService = require('../../services/audit.service');
const asyncHandler = require('../../middlewares/asyncHandler');
const { BadRequestError } = require('../../errors/AppError');

/** Le prix de l'abonnement est stocké en texte : il doit rester un entier positif. */
function validerPrix(cle, valeur) {
  if (cle !== 'prix_abonnement') return;
  const num = parseInt(valeur, 10);
  if (Number.isNaN(num) || num <= 0) {
    throw new BadRequestError('Le prix doit être un entier positif');
  }
}

exports.getAllConfigs = asyncHandler(async (req, res) => {
  const configs = await ConfigService.getAllConfigs();
  return res.status(200).json({ message: 'Configurations de l\'application', configs });
});

exports.ajouterConfig = asyncHandler(async (req, res) => {
  const { cle, valeur, description } = req.body;
  if (!cle || !valeur) throw new BadRequestError('cle et valeur sont requis');

  validerPrix(cle, valeur);

  const result = await ConfigService
    .ajouterConfig({ cle, valeur: String(valeur), description, adminId: req.user.id });
  return res.status(201).json(result);
});

exports.modifierConfig = asyncHandler(async (req, res) => {
  const { cle } = req.params;
  const { valeur, description } = req.body;
  if (!valeur) throw new BadRequestError('La valeur est requise');

  validerPrix(cle, valeur);

  const result = await ConfigService
    .modifierConfig({ cle, valeur: String(valeur), description, adminId: req.user.id });

  AuditService.enregistrer({ adminId: req.user.id, action: 'modifier_config', cible: 'config', cibleId: cle, details: { valeur } }).catch(() => {});
  return res.status(200).json(result);
});

exports.getPrixAbonnement = asyncHandler(async (req, res) => {
  const prix = await ConfigService.getPrixAbonnement();
  return res.status(200).json({ message: 'Prix abonnement actuel', prix, devise: 'FCFA' });
});
