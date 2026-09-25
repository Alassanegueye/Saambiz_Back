const { Utilisateur, Boutique, UserOtp, Commande, TokenBlacklist } = require('../models');
const { sendOtpEmail } = require('./resend.service');
const logger = require('../utils/logger');
const bcrypt = require('bcryptjs');
const { randomInt, randomUUID } = require('crypto');
const { Op } = require('sequelize');
const sequelize = require('../config/db');
const { uploadImage } = require('../middlewares/uploadService');
const { bcryptConfig } = require('../config/security');
const AuditService = require('./audit.service');

// HIGH-04 : protection brute-force OTP par email (en mémoire — Redis recommandé en prod)
const _otpAttempts = new Map();
const OTP_MAX_ATTEMPTS = 3;
const OTP_WINDOW_MS   = 15 * 60 * 1000;

function _checkOtpLimit(email) {
  const now = Date.now();
  let entry = _otpAttempts.get(email);
  if (entry && now >= entry.resetAt) { _otpAttempts.delete(email); entry = null; }
  if (entry && entry.count >= OTP_MAX_ATTEMPTS) {
    const restantMin = Math.ceil((entry.resetAt - now) / 60000);
    throw new Error(`Trop de tentatives OTP. Réessayez dans ${restantMin} minute(s).`);
  }
  if (!entry) { _otpAttempts.set(email, { count: 1, resetAt: now + OTP_WINDOW_MS }); }
  else { entry.count++; }
}

function _resetOtpLimit(email) { _otpAttempts.delete(email); }

class AccountService {

  static async getMe(userId) {
    const utilisateur = await Utilisateur.findByPk(userId, {
      attributes: { exclude: ['mot_de_passe'] },
      include: [
        { model: Boutique, as: 'boutiques', required: false }
      ]
    });
    if (!utilisateur) throw new Error('Utilisateur introuvable');
    return utilisateur;
  }

  static async updateProfile({ userId, data, photoFile }) {
    const t = await sequelize.transaction();
    try {
      const utilisateur = await Utilisateur.findByPk(userId, { transaction: t });
      if (!utilisateur) throw new Error('Utilisateur introuvable');

      const { nom, prenom, email, telephone, adresse, ville } = data;

      if (email && email !== utilisateur.email) {
        const exist = await Utilisateur.findOne({ where: { email }, transaction: t });
        if (exist) {
          await t.rollback();
          return { success: false, message: 'Cet email est déjà utilisé' };
        }
      }

      if (telephone && telephone !== utilisateur.telephone) {
        const exist = await Utilisateur.findOne({ where: { telephone }, transaction: t });
        if (exist) {
          await t.rollback();
          return { success: false, message: 'Ce numéro de téléphone est déjà utilisé' };
        }
      }

      let photoUrl = utilisateur.photoProfil;
      if (photoFile?.buffer) {
        photoUrl = await uploadImage(photoFile.buffer);
      }

      await utilisateur.update({ nom, prenom, email, telephone, adresse, ville, photoProfil: photoUrl }, { transaction: t });
      await t.commit();

      const updated = utilisateur.toJSON();
      delete updated.mot_de_passe;
      return { success: true, message: 'Profil mis à jour', utilisateur: updated };
    } catch (err) {
      await t.rollback();
      throw err;
    }
  }

  static async changePassword(userId, ancienMdp, nouveauMdp) {
    const utilisateur = await Utilisateur.findByPk(userId);
    if (!utilisateur) throw new Error('Utilisateur introuvable');

    const valid = await bcrypt.compare(ancienMdp, utilisateur.mot_de_passe);
    if (!valid) return { success: false, message: 'Ancien mot de passe incorrect' };

    const hash = await bcrypt.hash(nouveauMdp, bcryptConfig.saltRounds);
    await utilisateur.update({ mot_de_passe: hash });

    return { success: true, message: 'Mot de passe modifié avec succès' };
  }

  static async forgotPassword(email) {
    const utilisateur = await Utilisateur.findOne({ where: { email } });
    if (!utilisateur) {
      return { success: true, message: 'Si cet email existe, un code OTP a été envoyé' };
    }

    const otp = randomInt(100000, 1000000).toString();
    const otpHash = await bcrypt.hash(otp, bcryptConfig.saltRounds);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1h

    await UserOtp.destroy({ where: { utilisateurId: utilisateur.id } });
    await UserOtp.create({ utilisateurId: utilisateur.id, otpHash, expiresAt });

    // Réinitialiser le compteur de tentatives pour cette adresse
    _resetOtpLimit(email);

    try {
      await sendOtpEmail({ to: utilisateur.email, nom: utilisateur.nom, otp });
    } catch (mailErr) {
      logger.warn('[OTP] Échec envoi email Resend', { message: mailErr.message });
      if (process.env.NODE_ENV !== 'production') {
        logger.info(`[OTP DEV] Code pour ${email}: ${otp}`);
      }
    }

    return { success: true, message: 'Si cet email existe, un code OTP a été envoyé' };
  }

  static async resetPassword(email, otp, nouveauMdp) {
    // HIGH-04 : limite par email avant de vérifier le code (3 tentatives / 15 min)
    _checkOtpLimit(email);

    const utilisateur = await Utilisateur.findOne({ where: { email } });
    if (!utilisateur) return { success: false, message: 'Email introuvable' };

    const otpRecord = await UserOtp.findOne({
      where: {
        utilisateurId: utilisateur.id,
        expiresAt: { [Op.gte]: new Date() }
      }
    });

    if (!otpRecord) return { success: false, message: 'Code OTP invalide ou expiré' };

    const valid = await bcrypt.compare(otp, otpRecord.otpHash);
    if (!valid) {
      return { success: false, message: 'Code OTP incorrect' };
    }

    _resetOtpLimit(email); // succès — réinitialiser le compteur

    const hash = await bcrypt.hash(nouveauMdp, bcryptConfig.saltRounds);
    await utilisateur.update({ mot_de_passe: hash });
    await otpRecord.destroy();

    return { success: true, message: 'Mot de passe réinitialisé avec succès' };
  }

  // ----
  // Suppression de compte en libre-service (conformité Google Play "Account Deletion")
  // Soft-delete (paranoid) + anonymisation des données personnelles : préserve l'intégrité
  // référentielle des commandes historiques liées à d'autres utilisateurs.
  static async deleteAccount(userId, { motif, token, expiresAt } = {}) {
    const t = await sequelize.transaction();
    try {
      const utilisateur = await Utilisateur.findByPk(userId, { transaction: t });
      if (!utilisateur) {
        await t.rollback();
        return { success: false, message: 'Utilisateur introuvable' };
      }

      // Bloque la suppression si des commandes sont en cours (Acheteur ou Vendeur),
      // c'est-à-dire ni livrées ni annulées
      const commandeEnCours = await Commande.findOne({
        where: {
          [Op.or]: [{ acheteurId: userId }, { vendeurId: userId }],
          statut: { [Op.notIn]: ['livree', 'annulee'] }
        },
        transaction: t
      });

      if (commandeEnCours) {
        await t.rollback();
        return {
          success: false,
          message: 'Vous avez des commandes en cours, veuillez les finaliser avant de supprimer votre compte'
        };
      }

      // Anonymisation des champs personnels (droit à l'oubli)
      const emailAnonyme = `compte-supprime-${randomUUID()}@deleted.local`;
      const motDePasseAleatoire = await bcrypt.hash(randomUUID(), bcryptConfig.saltRounds);

      await utilisateur.update({
        nom: 'Compte',
        prenom: 'supprimé',
        email: emailAnonyme,
        telephone: null,
        adresse: null,
        photoProfil: null,
        mot_de_passe: motDePasseAleatoire,
        statut: 'inactif'
      }, { transaction: t });

      // Sequelize paranoid: true → positionne deletedAt sans supprimer la ligne ni casser les FK
      await utilisateur.destroy({ transaction: t });

      await t.commit();

      // Révoque le token courant (best-effort, hors transaction — la suppression est déjà actée)
      if (token) {
        try {
          await TokenBlacklist.create({ token, expiresAt: expiresAt || new Date(Date.now() + 3600000) });
        } catch (blErr) {
          logger.warn('[deleteAccount] Échec révocation token', { message: blErr.message });
        }
      }

      // Journal interne du motif de suppression (analytics) — ne doit jamais faire échouer l'opération
      AuditService.enregistrer({
        adminId: userId,
        action: 'compte_supprime_utilisateur',
        cible: 'utilisateur',
        cibleId: userId,
        details: { motif: motif || null }
      });

      return { success: true, message: 'Votre compte a été supprimé.' };
    } catch (err) {
      await t.rollback();
      throw err;
    }
  }
}

module.exports = AccountService;
