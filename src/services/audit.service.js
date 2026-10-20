// services/audit.service.js
// Journal d'audit des actions administrateur — ne doit jamais faire planter une action réelle
const { AuditLog, Utilisateur } = require('../models');
const { Op, fn, col, literal } = require('sequelize');
const logger = require('../utils/logger');

class AuditService {

  static async enregistrer({ adminId, action, cible, cibleId, details }) {
    try {
      await AuditLog.create({ adminId, action, cible, cibleId, details });
    } catch (err) {
      logger.error('audit.service:enregistrer', { message: err.message });
    }
  }

  /**
   * Journal filtrable : administrateur, action, type de cible, période.
   * `du` / `au` : dates ISO (YYYY-MM-DD) incluses.
   */
  static async lister({ page = 1, limit = 20, adminId, action, cible, du, au } = {}) {
    const where = AuditService._filtres({ adminId, action, cible, du, au });
    const l = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const p = Math.max(parseInt(page, 10) || 1, 1);

    const { rows, count } = await AuditLog.findAndCountAll({
      where,
      include: [{ model: Utilisateur, as: 'admin', attributes: ['id', 'nom', 'prenom', 'email', 'role'], paranoid: false }],
      order: [['createdAt', 'DESC']],
      limit: l,
      offset: (p - 1) * l,
    });

    return { logs: rows, total: count, page: p, pages: Math.ceil(count / l) };
  }

  static _filtres({ adminId, action, cible, du, au } = {}) {
    const where = {};
    if (adminId) where.adminId = adminId;
    if (action) where.action = action.includes('%') ? { [Op.iLike]: action } : { [Op.iLike]: `%${action}%` };
    if (cible) where.cible = cible;
    const debut = du ? new Date(`${du}T00:00:00`) : null;
    const fin = au ? new Date(`${au}T23:59:59.999`) : null;
    if ((debut && !Number.isNaN(debut.getTime())) || (fin && !Number.isNaN(fin.getTime()))) {
      where.createdAt = {};
      if (debut && !Number.isNaN(debut.getTime())) where.createdAt[Op.gte] = debut;
      if (fin && !Number.isNaN(fin.getTime())) where.createdAt[Op.lte] = fin;
    }
    return where;
  }

  /**
   * Vue d'ensemble de l'activité sur la période : chiffres clés et une ligne
   * par administrateur (actions, dernière action, dernière connexion).
   */
  static async resume({ du, au } = {}) {
    const where = AuditService._filtres({ du, au });

    const parAdmin = await AuditLog.findAll({
      where,
      attributes: [
        'adminId',
        [fn('COUNT', col('id')), 'actions'],
        [fn('SUM', literal("CASE WHEN action = 'connexion' THEN 1 ELSE 0 END")), 'connexions'],
        [fn('MAX', col('created_at')), 'derniereAction'],
      ],
      group: ['adminId'],
      raw: true,
    });

    const parType = await AuditLog.findAll({
      where: { ...where, action: { [Op.ne]: 'connexion' } },
      attributes: ['cible', [fn('COUNT', col('id')), 'nombre']],
      group: ['cible'],
      raw: true,
    });

    const admins = await Utilisateur.findAll({
      where: { role: { [Op.in]: ['Admin', 'SuperAdmin'] } },
      attributes: ['id', 'nom', 'prenom', 'email', 'role', 'statut', 'premiereConnexion', 'derniereConnexion'],
      order: [['prenom', 'ASC']],
    });
    const stats = new Map(parAdmin.map((r) => [r.adminId, r]));

    const lignes = admins.map((a) => {
      const st = stats.get(a.id);
      return {
        ...a.toJSON(),
        actions: Number(st?.actions || 0),
        connexions: Number(st?.connexions || 0),
        derniereAction: st?.derniereAction || null,
      };
    }).sort((x, y) => y.actions - x.actions);

    const total = lignes.reduce((t, l) => t + l.actions, 0);
    const connexions = lignes.reduce((t, l) => t + l.connexions, 0);
    const suppressions = await AuditLog.count({ where: { ...where, action: { [Op.iLike]: 'supprimer%' } } });

    return {
      chiffres: {
        actions: total - connexions,
        connexions,
        suppressions,
        adminsActifs: lignes.filter((l) => l.actions > 0).length,
      },
      admins: lignes,
      parType: parType.map((r) => ({ cible: r.cible, nombre: Number(r.nombre) })).sort((x, y) => y.nombre - x.nombre),
    };
  }
}

module.exports = AuditService;
