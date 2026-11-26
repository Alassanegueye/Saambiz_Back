const bcrypt = require('bcryptjs');
const { Op, fn, col, where } = require('sequelize');
const { Utilisateur, Menu, Permission, sequelize } = require('../models');
const { generatePassword } = require('../utils/generatePassword');
const { sendNewAdminEmail } = require('./resend.service');
const { bcryptConfig } = require('../config/security');
const logger = require('../utils/logger');

/**
 * Adresse d'un compte supprimé, rendue libre : `supprime.<8 car. de l'id>.<adresse>`.
 *
 * `utilisateur` est paranoïaque (suppression logique) et son adresse est
 * unique en base, supprimés compris : sans cela, un administrateur supprimé
 * gardait son adresse pour toujours, et on ne pouvait plus recréer un admin
 * avec le même e-mail. La forme reste une adresse valide (validation isEmail
 * du modèle) et garde la trace de l'adresse d'origine.
 */
const adresseLiberee = (utilisateur) => {
  const [local, domaine] = String(utilisateur.email).split('@');
  return `supprime.${String(utilisateur.id).slice(0, 8)}.${local}@${domaine}`.slice(0, 255);
};

const PREFIXE_LIBERE = /^supprime\.[0-9a-f]{8}\./i;

/** Libère l'adresse (et le téléphone) d'un compte supprimé ou à supprimer. */
async function libererIdentifiants(utilisateur, options = {}) {
  if (PREFIXE_LIBERE.test(utilisateur.email || '')) return;
  await utilisateur.update(
    { email: adresseLiberee(utilisateur), telephone: null },
    { ...options, hooks: false },
  );
}

class AdminManagementService {

  /**
   * Crée un nouvel administrateur avec permissions et envoi d'email
   */
  static async creerAdmin({ nom, prenom, email, permissions = [], motDePasse = null, envoyerIdentifiants = true, accesKodafrik = false }) {
    // Supprimés compris : un compte supprimé AVANT que la suppression ne
    // libère l'adresse la retient encore — on la libère ici.
    const existing = await Utilisateur.findOne({
      where: where(fn('lower', col('email')), email.toLowerCase().trim()),
      paranoid: false,
    });
    if (existing && existing.isSoftDeleted()) {
      await libererIdentifiants(existing);
    } else if (existing) {
      throw Object.assign(new Error('Un utilisateur avec cet email existe déjà.'), { status: 409 });
    }

    let password;
    if (motDePasse !== null && motDePasse !== undefined && String(motDePasse).trim() !== '') {
      const { passwordSchema } = require('../validators/auth.validator');
      const { error } = passwordSchema.validate(String(motDePasse));
      if (error) {
        throw Object.assign(new Error(error.message), { status: 400 });
      }
      password = String(motDePasse);
    } else {
      password = generatePassword();
    }
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
        accesKodafrik: Boolean(accesKodafrik),
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

      if (envoyerIdentifiants !== false) {
        sendNewAdminEmail({
          to: admin.email,
          nom: admin.nom,
          prenom: admin.prenom,
          email: admin.email,
          password,
        }).catch((err) => logger.error('sendNewAdminEmail:failed', { error: err.message }));
      }

      return admin;
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }

  /**
   * Liste tous les admins actifs (non supprimés)
   */
  /** Modifie l'identité et l'accès Kodafrik d'un administrateur. */
  static async modifierAdmin(userId, { nom, prenom, email, accesKodafrik }) {
    const admin = await Utilisateur.findOne({ where: { id: userId, role: 'Admin' } });
    if (!admin) throw Object.assign(new Error('Administrateur introuvable.'), { status: 404 });
    const champs = {};
    if (nom !== undefined) champs.nom = String(nom).trim();
    if (prenom !== undefined) champs.prenom = String(prenom).trim();
    if (typeof accesKodafrik === 'boolean') champs.accesKodafrik = accesKodafrik;
    if (email !== undefined) {
      champs.email = String(email).trim().toLowerCase();
      const pris = await Utilisateur.findOne({ where: { email: champs.email } });
      if (pris && pris.id !== admin.id) {
        throw Object.assign(new Error('Un utilisateur avec cet email existe déjà.'), { status: 409 });
      }
    }
    if (champs.nom === '' || champs.prenom === '') {
      throw Object.assign(new Error('Nom et prénom sont requis.'), { status: 400 });
    }
    await admin.update(champs);
    return { id: admin.id, nom: admin.nom, prenom: admin.prenom, email: admin.email, accesKodafrik: Boolean(admin.accesKodafrik) };
  }

  static async listerAdmins() {
    return Utilisateur.findAll({
      where: { role: 'Admin' },
      attributes: ['id', 'nom', 'prenom', 'email', 'statut', 'isFirstLogin', 'accesKodafrik', 'premiereConnexion', 'derniereConnexion', 'createdAt'],
      order: [['createdAt', 'DESC']],
    });
  }

  /**
   * Suppression logique d'un administrateur (paranoid).
   *
   * Deux garde-fous, et ils ne protègent pas contre un attaquant : ils
   * protègent contre une fausse manœuvre d'un administrateur légitime.
   *
   *  1. ON NE SE SUPPRIME PAS SOI-MÊME. Le geste est irréversible depuis
   *     l'interface, et l'intention est presque toujours « retirer l'accès de
   *     quelqu'un d'autre » — une ligne cliquée trop vite dans un tableau.
   *  2. LE DERNIER ADMINISTRATEUR NE PEUT PAS DISPARAÎTRE. Sans cela, le
   *     back-office devient inaccessible à TOUT LE MONDE : plus personne ne
   *     peut créer un administrateur, puisque la route qui le permet exige
   *     déjà d'en être un. La seule sortie serait une intervention en base.
   *
   * @param {string} userId - l'administrateur à retirer.
   * @param {{ demandeurId?: string }} [contexte] - qui demande la suppression.
   *   Facultatif pour que les appels internes et les scripts restent
   *   possibles ; le contrôleur le fournit toujours.
   */
  static async supprimerAdmin(userId, { demandeurId = null } = {}) {
    const admin = await Utilisateur.findOne({ where: { id: userId, role: 'Admin' } });
    if (!admin) {
      throw Object.assign(new Error('Administrateur introuvable.'), { status: 404 });
    }

    if (demandeurId && String(demandeurId) === String(userId)) {
      throw Object.assign(
        new Error(
          'Vous ne pouvez pas supprimer votre propre compte administrateur. '
          + 'Demandez à un autre administrateur de le faire.',
        ),
        { status: 400 },
      );
    }

    const restants = await Utilisateur.count({
      where: { role: 'Admin', id: { [Op.ne]: userId } },
    });
    if (restants === 0) {
      throw Object.assign(
        new Error(
          'Impossible de supprimer le dernier administrateur : personne ne '
          + 'pourrait plus accéder au back-office. Créez un autre '
          + 'administrateur avant de retirer celui-ci.',
        ),
        { status: 409 },
      );
    }

    // Suppression logique (paranoid), adresse et téléphone libérés : on peut
    // recréer un administrateur avec le même e-mail.
    await sequelize.transaction(async (transaction) => {
      await libererIdentifiants(admin, { transaction });
      await admin.destroy({ transaction });
    });
    logger.warn('admin_supprime', { cible: userId, parQui: demandeurId, restants });
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
   * Remplace les permissions d'un administrateur.
   *
   * La cible est vérifiée : ces lignes n'ont de sens que pour un compte
   * d'administration, puisque `requirePermission` ne s'exécute qu'après
   * `isAdmin`. Les écrire sur un vendeur ou un client ne donnait aucun accès
   * — elles restaient inertes — mais laissait en base des droits qui n'en
   * sont pas. Une incohérence de ce genre attend qu'on s'appuie dessus : il
   * suffit qu'un jour une route lise la table des permissions sans passer par
   * `isAdmin` pour qu'elle devienne une faille.
   */
  static async updatePermissions(userId, permissions) {
    const cible = await Utilisateur.findOne({ where: { id: userId, role: 'Admin' } });
    if (!cible) {
      throw Object.assign(
        new Error('Les permissions ne peuvent être attribuées qu\'à un administrateur.'),
        { status: 404 },
      );
    }

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
module.exports.adresseLiberee = adresseLiberee;
module.exports.PREFIXE_LIBERE = PREFIXE_LIBERE;
