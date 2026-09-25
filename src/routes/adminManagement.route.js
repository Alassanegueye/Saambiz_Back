const router = require('express').Router();
const ctrl = require('../controllers/adminManagement.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const checkActiveUser = require('../middlewares/checkActiveUser.middleware');
const isAdmin = require('../middlewares/isAdmin.middleware');
const requirePermission = require('../middlewares/requirePermission.middleware');

// Chaîne complète : identité → compte actif → rôle → permission fine.
// Il manquait ici le contrôle du compte actif et celui du rôle : un compte
// suspendu, ou un simple vendeur muni d'un jeton valide, atteignait la
// gestion des administrateurs.
router.use(authMiddleware);
router.use(checkActiveUser);
router.use(isAdmin);

// ── Admins ────────────────────────────────────────────────────────────────
router.post('/admins',
  requirePermission('ADMINS', 'create'),
  ctrl.creerAdmin);
router.get('/admins',
  requirePermission('ADMINS', 'view'),
  ctrl.listerAdmins);
router.delete('/admins/:userId',
  requirePermission('ADMINS', 'delete'),
  ctrl.supprimerAdmin);
router.get('/admins/:userId/permissions',
  requirePermission('ADMINS', 'view'),
  ctrl.getPermissions);
router.put('/admins/:userId/permissions',
  requirePermission('ADMINS', 'update'),
  ctrl.updatePermissions);

// ── Menus ─────────────────────────────────────────────────────────────────
router.get('/menus',
  requirePermission('MENUS', 'view'),
  ctrl.listerMenus);
router.post('/menus',
  requirePermission('MENUS', 'create'),
  ctrl.creerMenu);
router.put('/menus/:id',
  requirePermission('MENUS', 'update'),
  ctrl.modifierMenu);
router.delete('/menus/:id',
  requirePermission('MENUS', 'delete'),
  ctrl.supprimerMenu);

module.exports = router;
