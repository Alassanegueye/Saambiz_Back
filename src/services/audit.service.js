// services/audit.service.js
// Journal d'audit des actions administrateur — ne doit jamais faire planter une action réelle
const { AuditLog, Utilisateur } = require('../models');
const { Op } = require('sequelize');
const logger = require('../utils/logger');

class AuditService {

  static async enregistrer({ adminId, action, cible, cibleId, details }) {
    try {
      await AuditLog.create({ adminId, action, cible, cibleId, details });
    } catch (err) {
      logger.error('audit.service:enregistrer', { message: err.message });
    }
  }

  static async lister({ page = 1, limit = 20, adminId, action } = {}) {
    const where = {};
    if (adminId) where.adminId = adminId;
    if (action) where.action = { [Op.iLike]: `%${action}%` };

    const l = parseInt(limit);
    const offset = (parseInt(page) - 1) * l;

    const { rows, count } = await AuditLog.findAndCountAll({
      where,
      include: [{ model: Utilisateur, as: 'admin', attributes: ['id', 'nom', 'prenom', 'email'] }],
      order: [['createdAt', 'DESC']],
      limit: l,
      offset,
    });

    return {
      logs: rows,
      total: count,
      page: parseInt(page),
      pages: Math.ceil(count / l),
    };
  }
}

module.exports = AuditService;
