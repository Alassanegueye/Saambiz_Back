const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { RefreshToken } = require('../models');
const { jwtConfig, refreshTokenConfig } = require('../config/security');
const logger = require('../utils/logger');

/**
 * Cycle de vie des jetons de rafraîchissement.
 *
 * Toute la logique tient ici pour que l'émission, la rotation et la
 * révocation restent cohérentes : trois endroits différents qui manipulent
 * ces jetons finissent toujours par diverger sur un détail — et le détail,
 * en sécurité, c'est la faille.
 */
class RefreshTokenService {
  /** Empreinte stockée en base. Le jeton en clair ne sort jamais d'ici. */
  static _hash(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Émet un refresh, l'enregistre hashé, et applique le plafond de sessions.
   * @param {object} contexte - `userAgent` et `ip` pour l'écran des appareils.
   */
  static async emettre(utilisateurId, contexte = {}) {
    // `jti` aléatoire : sans lui, deux jetons émis pour le même utilisateur
    // dans la même seconde ont une charge utile identique — `iat` est en
    // secondes — donc la même signature et la même empreinte. La rotation
    // révoquerait alors le jeton qu'elle vient d'émettre, et l'utilisateur
    // serait déconnecté au rafraîchissement suivant.
    const token = jwt.sign(
      { id: utilisateurId, jti: crypto.randomUUID() },
      jwtConfig.refreshSecret,
      { expiresIn: jwtConfig.refreshExpiresIn }
    );

    const expiresAt = new Date(
      Date.now() + refreshTokenConfig.dureeJours * 24 * 60 * 60 * 1000
    );

    await RefreshToken.create({
      utilisateurId,
      tokenHash: this._hash(token),
      expiresAt,
      userAgent: (contexte.userAgent || '').slice(0, 255) || null,
      adresseIp: contexte.ip || null,
    });

    await this._appliquerPlafond(utilisateurId);
    return token;
  }

  /**
   * Vérifie un refresh : signature, puis présence en base et non-révocation.
   *
   * La double vérification est le point important. Un jeton signé mais absent
   * de la table est un jeton révoqué — c'est ce qui rend la déconnexion et la
   * coupure d'un appareil réellement effectives.
   */
  static async verifier(token) {
    let charge;
    try {
      charge = jwt.verify(token, jwtConfig.refreshSecret);
    } catch {
      return { valide: false, motif: 'Jeton de rafraîchissement invalide ou expiré' };
    }

    const enregistrement = await RefreshToken.findOne({
      where: { tokenHash: this._hash(token) },
    });

    if (!enregistrement) {
      // Signature valide mais absent de la table : soit révoqué, soit émis
      // avant la mise en place de ce stockage. On trace, c'est le signal
      // qu'on verrait en cas de rejeu d'un jeton volé.
      logger.warn('refresh_token_inconnu', { utilisateurId: charge.id });
      return { valide: false, motif: 'Session expirée, reconnectez-vous' };
    }
    if (enregistrement.revokedAt) {
      return { valide: false, motif: 'Session révoquée, reconnectez-vous' };
    }
    if (enregistrement.expiresAt < new Date()) {
      return { valide: false, motif: 'Session expirée, reconnectez-vous' };
    }

    return { valide: true, utilisateurId: charge.id, enregistrement };
  }

  /**
   * Rotation : révoque l'ancien jeton et en émet un neuf.
   *
   * Un refresh ne sert qu'une fois. Si le même est présenté deux fois, la
   * seconde tentative échoue — ce qui trahit un vol au lieu de le laisser
   * passer inaperçu.
   */
  static async faireTourner(ancienToken, contexte = {}) {
    const controle = await this.verifier(ancienToken);
    if (!controle.valide) return controle;

    await controle.enregistrement.update({ revokedAt: new Date() });
    const nouveau = await this.emettre(controle.utilisateurId, contexte);

    return { valide: true, utilisateurId: controle.utilisateurId, token: nouveau };
  }

  /** Révoque un jeton précis — appelé à la déconnexion. */
  static async revoquer(token) {
    const [nb] = await RefreshToken.update(
      { revokedAt: new Date() },
      { where: { tokenHash: this._hash(token), revokedAt: null } }
    );
    return nb > 0;
  }

  /** Révoque toutes les sessions d'un compte — changement de mot de passe, suspension. */
  static async revoquerTout(utilisateurId) {
    const [nb] = await RefreshToken.update(
      { revokedAt: new Date() },
      { where: { utilisateurId, revokedAt: null } }
    );
    if (nb) logger.info('sessions_revoquees', { utilisateurId, nb });
    return nb;
  }

  /** Sessions actives d'un compte, de la plus récente à la plus ancienne. */
  static async listerSessions(utilisateurId) {
    return RefreshToken.findAll({
      where: { utilisateurId, revokedAt: null },
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'userAgent', 'adresseIp', 'createdAt', 'expiresAt'],
    });
  }

  /** Au-delà du plafond, les sessions les plus anciennes sont révoquées. */
  static async _appliquerPlafond(utilisateurId) {
    const actives = await RefreshToken.findAll({
      where: { utilisateurId, revokedAt: null },
      order: [['createdAt', 'DESC']],
    });
    const surplus = actives.slice(refreshTokenConfig.maxParUtilisateur);
    if (surplus.length === 0) return;

    await RefreshToken.update(
      { revokedAt: new Date() },
      { where: { id: surplus.map((t) => t.id) } }
    );
    logger.info('plafond_sessions_atteint', { utilisateurId, revoquees: surplus.length });
  }

  /**
   * Purge des jetons expirés ou révoqués depuis longtemps.
   * Appelée par le cron ; les révoqués sont gardés 30 jours pour l'audit.
   */
  static async purger() {
    const { Op } = require('sequelize');
    const ilYaUnMois = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    return RefreshToken.destroy({
      where: {
        [Op.or]: [
          { expiresAt: { [Op.lt]: new Date() } },
          { revokedAt: { [Op.lt]: ilYaUnMois } },
        ],
      },
    });
  }
}

module.exports = RefreshTokenService;
