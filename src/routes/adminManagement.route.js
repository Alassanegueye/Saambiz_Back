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
router.put('/admins/:userId',
  requirePermission('ADMINS', 'update'),
  ctrl.modifierAdmin);
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
//
// La LECTURE est protégée par 'ADMINS' et non 'MENUS' : c'est la page
// « Administrateurs » qui appelle cette route, pour construire la grille des
// accès (quels menus cocher pour quel admin). Elle demande donc exactement le
// même droit que la page qui la consomme.
//
// 'MENUS' était impossible à satisfaire : la rubrique a été retirée du
// dashboard (migration 20261026_retrait_menus_signalements.sql) et ne figure
// plus dans les menus créés par seedMenus.js. Sur une base neuve, aucune ligne
// `menus` ne porte ce code, donc aucune permission ne peut y renvoyer — la
// route répondait 403 à tout le monde, super-admin compris, et la page
// affichait « Erreur lors du chargement des menus » sans autre indication.
router.get('/menus',
  requirePermission('ADMINS', 'view'),
  ctrl.listerMenus);
// Les trois routes d'écriture ci-dessous restent sur 'MENUS', donc fermées :
// la rubrique étant retirée, aucune interface ne les appelle. Les rouvrir
// demanderait de recréer un menu de code 'MENUS' ou de les rattacher à un
// autre droit — à décider le jour où une interface en aura besoin.
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
