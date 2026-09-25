const { Permission, Menu } = require('../models');
const logger = require('../utils/logger');

/**
 * Contrôle des permissions RBAC, côté serveur.
 *
 * Le système de permissions existait déjà en base et le dashboard s'en
 * servait pour composer sa navigation — mais rien ne le vérifiait à
 * l'arrivée. Un administrateur aux droits restreints atteignait donc toutes
 * les routes en appelant l'API directement : la restriction n'était qu'un
 * masquage d'interface.
 *
 * Modèle STRICT : aucune ligne de permission = aucun accès. L'accès total se
 * donne explicitement, jamais par défaut — c'est la différence entre « on a
 * oublié de donner le droit » (refus, visible tout de suite) et « on a oublié
 * de retirer le droit » (faille, invisible).
 *
 * Usage : router.use(auth, checkActiveUser, isAdmin);
 *         router.delete('/x/:id', requirePermission('PRODUITS', 'delete'), ctrl);
 */

/** Rôles qui court-circuitent la table des permissions. */
const ROLES_TOUT_ACCES = ['SuperAdmin'];

const ACTIONS = {
  view:   'canView',
  create: 'canCreate',
  update: 'canUpdate',
  delete: 'canDelete',
};

/**
 * @param {string|string[]} codesMenu - code du menu concerné, ou liste de
 *   codes dont un seul suffit (`['PRODUITS', 'MODERATION']`).
 * @param {'view'|'create'|'update'|'delete'} action
 */
function requirePermission(codesMenu, action = 'view') {
  const codes = Array.isArray(codesMenu) ? codesMenu : [codesMenu];
  const colonne = ACTIONS[action];

  if (!colonne) {
    // Erreur de programmation, pas d'exécution : on la fait éclater au
    // montage des routes plutôt qu'à la première requête en production.
    throw new Error(
      `[RBAC] Action inconnue "${action}". Attendu : ${Object.keys(ACTIONS).join(', ')}`
    );
  }

  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'Non authentifié.' });
      }

      if (ROLES_TOUT_ACCES.includes(req.user.role)) return next();

      const permissions = await Permission.findAll({
        where: { userId: req.user.id },
        include: [{
          model: Menu,
          as: 'menu',
          where: { code: codes },
          required: true,
        }],
      });

      const autorise = permissions.some((p) => p[colonne] === true);

      if (!autorise) {
        // On trace : une série de refus sur un même compte est le signal
        // d'une tentative d'élévation, ou d'un droit oublié à l'attribution.
        logger.warn('rbac_refus', {
          utilisateurId: req.user.id,
          role: req.user.role,
          menus: codes,
          action,
          url: req.originalUrl,
        });
        return res.status(403).json({
          success: false,
          message: "Vous n'avez pas les droits nécessaires pour cette action.",
        });
      }

      return next();
    } catch (err) {
      logger.error('rbac_erreur', { message: err.message, url: req.originalUrl });
      // En cas de panne de la vérification, on refuse. Laisser passer
      // « parce que la base ne répond pas » transformerait une panne en
      // porte ouverte.
      return res.status(503).json({
        success: false,
        message: 'Vérification des droits indisponible, réessayez.',
      });
    }
  };
}

module.exports = requirePermission;
