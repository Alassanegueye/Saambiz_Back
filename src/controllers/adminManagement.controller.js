const AdminManagementService = require('../services/admin.management.service');
const MenuService = require('../services/menu.service');
const asyncHandler = require('../middlewares/asyncHandler');
const { BadRequestError } = require('../errors/AppError');
const AuditService = require('../services/audit.service');
const echecIgnore = require('../utils/echecIgnore');
const CodeAccesService = require('../services/codeAcces.service');

/** Trace une action dans l'activité des admins, sans jamais faire échouer la requête. */
const tracer = (req, action, cible, cibleId, details = {}) =>
  AuditService.enregistrer({ adminId: req.user.id, action, cible, cibleId, details }).catch(echecIgnore('journal d\'audit (gestion des admins)'));

/**
 * Gestion des comptes administrateurs et des menus RBAC.
 *
 * Les services lèvent des erreurs portant leur propre `status` : le
 * gestionnaire global les relaie, il n'y a plus de try/catch ici.
 */

// ── Admins ────────────────────────────────────────────────────────────────

exports.creerAdmin = asyncHandler(async (req, res) => {
  const { nom, prenom, email, permissions, codeAcces } = req.body;
  if (!nom || !prenom || !email) {
    throw new BadRequestError('nom, prenom et email sont requis.');
  }
  // Le code d'accès (portail KODAFRIK), contrôlé AVANT la création : un
  // compte créé sans son code ne pourrait pas ouvrir l'administration.
  if (codeAcces !== undefined && !/^\d{4}$/.test(String(codeAcces))) {
    throw new BadRequestError("Le code d'accès fait exactement quatre chiffres.");
  }

  const admin = await AdminManagementService.creerAdmin({ nom, prenom, email, permissions });
  if (codeAcces !== undefined) {
    await CodeAccesService.definir(admin.id, String(codeAcces), { auteurId: req.user.id });
  }
  tracer(req, 'creer_admin', 'admin', admin.id, { nom: `${prenom} ${nom}`, email });
  res.status(201).json({
    message: 'Administrateur créé avec succès.',
    admin: { id: admin.id, nom: admin.nom, prenom: admin.prenom, email: admin.email },
  });
});

/** Pose ou change le code d'accès d'un administrateur. Corps : { codeAcces }. */
exports.definirCodeAcces = asyncHandler(async (req, res) => {
  const code = req.body?.codeAcces ?? req.body?.code_acces;
  await CodeAccesService.definir(req.params.userId, code === undefined ? '' : String(code), { auteurId: req.user.id });
  tracer(req, 'changer_code_acces', 'admin', req.params.userId);
  res.json({ success: true, message: "Code d'accès enregistré." });
});

exports.listerAdmins = asyncHandler(async (req, res) => {
  const admins = await AdminManagementService.listerAdmins();
  res.json({ admins });
});

exports.modifierAdmin = asyncHandler(async (req, res) => {
  const admin = await AdminManagementService.modifierAdmin(req.params.userId, req.body || {});
  tracer(req, 'modifier_admin', 'admin', req.params.userId, { email: admin?.email });
  res.json({ message: 'Administrateur mis à jour.', admin });
});

exports.supprimerAdmin = asyncHandler(async (req, res) => {
  // L'identité du demandeur vient du jeton, jamais du corps de la requête :
  // c'est elle qui permet au service de refuser une auto-suppression.
  const result = await AdminManagementService.supprimerAdmin(req.params.userId, {
    demandeurId: req.user.id,
  });
  tracer(req, 'supprimer_admin', 'admin', req.params.userId);
  res.json(result);
});

exports.getPermissions = asyncHandler(async (req, res) => {
  const perms = await AdminManagementService.getPermissions(req.params.userId);
  res.json({ permissions: perms });
});

exports.updatePermissions = asyncHandler(async (req, res) => {
  const result = await AdminManagementService.updatePermissions(
    req.params.userId,
    req.body.permissions || []
  );
  tracer(req, 'modifier_permissions', 'admin', req.params.userId, {
    menus: (req.body.permissions || []).filter((p) => p.canView || p.canCreate || p.canUpdate || p.canDelete).length,
  });
  res.json(result);
});

// ── Menus ─────────────────────────────────────────────────────────────────

exports.listerMenus = asyncHandler(async (req, res) => {
  const menus = await MenuService.listerTousMenus();
  res.json({ menus });
});

exports.creerMenu = asyncHandler(async (req, res) => {
  const menu = await MenuService.creerMenu(req.body);
  tracer(req, 'creer_menu', 'menu', menu?.id, { nom: menu?.name });
  res.status(201).json({ menu });
});

exports.modifierMenu = asyncHandler(async (req, res) => {
  const menu = await MenuService.modifierMenu(req.params.id, req.body);
  tracer(req, 'modifier_menu', 'menu', req.params.id, { nom: menu?.name });
  res.json({ menu });
});

exports.supprimerMenu = asyncHandler(async (req, res) => {
  const result = await MenuService.supprimerMenu(req.params.id);
  tracer(req, 'supprimer_menu', 'menu', req.params.id);
  res.json(result);
});
