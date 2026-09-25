const bcrypt = require('bcryptjs');
const { Utilisateur, Menu, Permission, sequelize } = require('../models');
const { generatePassword } = require('../utils/generatePassword');
const { sendNewAdminEmail } = require('./resend.service');
const { bcryptConfig } = require('../config/security');
const logger = require('../utils/logger');

class AdminManagementService {

  /**
   * Crée un nouvel administrateur avec permissions et envoi d'email
   */
  static async creerAdmin({ nom, prenom, email, permissions = [] }) {
    const existing = await Utilisateur.findOne({ where: { email: email.toLowerCase().trim() } });
    if (existing) {
      throw Object.assign(new Error('Un utilisateur avec cet email existe déjà.'), { status: 409 });
    }

    const password = generatePassword();
    const hash = await bcrypt.hash(password, bcryptConfig.saltRounds);

    const transaction = await sequelize.transaction();
    try {
      const admin = await Utilisateur.create({
        nom: nom.trim(),
        prenom: prenom.trim(),
        email: email.toLowerCase().trim(),
        mot_de_passe: hash,
        role: 'Admin',
        isFirstLogin: true,
        statut: 'actif',
        verifie: true,
      }, { transaction });

      if (permissions.length > 0) {
        const permRows = permissions.map((p) => ({
          userId:    admin.id,
          menuId:    p.menuId,
          canView:   p.canView   ?? false,
          canCreate: p.canCreate ?? false,
          canUpdate: p.canUpdate ?? false,
          canDelete: p.canDelete ?? false,
        }));
        await Permission.bulkCreate(permRows, { transaction });
      }

      await transaction.commit();

      sendNewAdminEmail({
        to: admin.email,
        nom: admin.nom,
        prenom: admin.prenom,
        email: admin.email,
        password,
      }).catch((err) => logger.error('sendNewAdminEmail:failed', { error: err.message }));

      return admin;
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }

  /**
   * Liste tous les admins actifs (non supprimés)
   */
  static async listerAdmins() {
    return Utilisateur.findAll({
      where: { role: 'Admin' },
      attributes: ['id', 'nom', 'prenom', 'email', 'statut', 'isFirstLogin', 'createdAt'],
      order: [['createdAt', 'DESC']],
    });
  }

  /**
   * Soft delete d'un admin (paranoid)
   */
  static async supprimerAdmin(userId) {
    const admin = await Utilisateur.findOne({ where: { id: userId, role: 'Admin' } });
    if (!admin) {
      throw Object.assign(new Error('Administrateur introuvable.'), { status: 404 });
    }
    await admin.destroy(); // paranoid soft delete
    return { message: 'Administrateur supprimé.' };
  }

  /**
   * Récupère les permissions d'un admin
   */
  static async getPermissions(userId) {
    return Permission.findAll({
      where: { userId },
      include: [{ model: Menu, as: 'menu', attributes: ['id', 'name', 'code', 'path', 'icon'] }],
    });
  }

  /**
   * Met à jour les permissions d'un admin (remplace tout)
   */
  static async updatePermissions(userId, permissions) {
    const transaction = await sequelize.transaction();
    try {
      await Permission.destroy({ where: { userId }, transaction });
      if (permissions.length > 0) {
        const rows = permissions.map((p) => ({
          userId,
          menuId:    p.menuId,
          canView:   p.canView   ?? false,
          canCreate: p.canCreate ?? false,
          canUpdate: p.canUpdate ?? false,
          canDelete: p.canDelete ?? false,
        }));
        await Permission.bulkCreate(rows, { transaction });
      }
      await transaction.commit();
      return { message: 'Permissions mises à jour.' };
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }
}

module.exports = AdminManagementService;
