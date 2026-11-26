const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { RefreshToken } = require('../models');
const { jwtConfig, refreshTokenConfig } = require('../config/security');
const logger = require('../utils/logger');
const echecIgnore = require('../utils/echecIgnore');

/**
 * Cycle de vie des jetons de rafraîchissement.
 *
 * Toute la logique tient ici pour que l'émission, la rotation et la
 * révocation restent cohérentes : trois endroits différents qui manipulent
 * ces jetons finissent toujours par diverger sur un détail — et le détail,
 * en sécurité, c'est la faille.
 */
// Délai pendant lequel un jeton déjà remplacé peut encore être présenté.
const DELAI_GRACE_MS = 10 * 60 * 1000;

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

    const ligne = await RefreshToken.create({
      utilisateurId,
      tokenHash: this._hash(token),
      expiresAt,
      userAgent: (contexte.userAgent || '').slice(0, 255) || null,
      adresseIp: contexte.ip || null,
    });

    await this._appliquerPlafond(utilisateurId);
    return contexte.avecLigne ? { token, ligne } : token;
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
      charge = jwt.verify(token, jwtConfig.refreshSecret, jwtConfig.optionsVerification);
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

    // INACTIVITÉ. Un jeton vit dix ans ; une session, une semaine de
    // silence. Sans cette borne, un téléphone reposé pendant des mois
    // rouvrait directement sur le compte — et un téléphone perdu restait
    // ouvert indéfiniment.
    //
    // L'âge de la ligne suffit à le dire : chaque rotation en écrit une
    // neuve, donc `createdAt` est l'heure du dernier usage. La fenêtre
    // glisse à chaque renouvellement, elle ne plafonne pas la session :
    // qui revient au moins une fois par semaine n'est jamais coupé.
    const inactif = Date.now() - new Date(enregistrement.createdAt).getTime();
    if (inactif > refreshTokenConfig.inactiviteMaxMs) {
      // Révoquée plutôt que laissée en place : le jeton ne doit pas pouvoir
      // resservir, et la révocation se lit dans les sessions de l'appareil.
      await enregistrement.update({ revokedAt: new Date() }).catch(echecIgnore('révocation du jeton de rafraîchissement'));
      logger.info('refresh_inactivite', {
        utilisateurId: charge.id,
        inactifMinutes: Math.round(inactif / 60000),
      });
      return {
        valide: false,
        motif: 'Vous avez été déconnecté après une semaine sans activité. Reconnectez-vous.',
        inactivite: true,
      };
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
    let controle = await this.verifier(ancienToken);

    // Délai de grâce : le jeton vient d'être remplacé par une rotation, mais
    // le téléphone n'a jamais reçu le remplaçant (réseau coupé, application
    // fermée pendant la réponse, deux renouvellements simultanés). Plutôt que
    // de déconnecter l'utilisateur, on coupe le remplaçant perdu et on en
    // émet un autre. Une déconnexion (révocation sans rotation) n'en profite
    // jamais.
    if (!controle.valide) {
      // Une session fermée pour inactivité ne profite d'aucun rattrapage :
      // le délai de grâce existe pour un remplaçant perdu en chemin, pas
      // pour rouvrir ce que le temps a fermé.
      if (controle.inactivite) return controle;
      const grace = await this._dansLeDelaiDeGrace(ancienToken);
      if (!grace) return controle;
      if (grace.remplacePar) {
        await RefreshToken.update(
          { revokedAt: new Date() },
          { where: { id: grace.remplacePar, revokedAt: null } }
        );
      }
      controle = { valide: true, utilisateurId: grace.utilisateurId, enregistrement: grace };
      logger.info('refresh_delai_de_grace', { utilisateurId: grace.utilisateurId });
    }

    const { token: nouveau, ligne } = await this.emettre(
      controle.utilisateurId,
      { ...contexte, avecLigne: true },
    );
    await controle.enregistrement.update({
      revokedAt: controle.enregistrement.revokedAt || new Date(),
      rotatedAt: new Date(),
      // La ligne du remplaçant sert au délai de grâce ; sans elle, la
      // rotation reste valable, seul ce filet manque.
      remplacePar: ligne?.id ?? null,
    });

    const codeAcces = await this._transmettreCodeAcces(controle.enregistrement.id, ligne?.id);
    return { valide: true, utilisateurId: controle.utilisateurId, token: nouveau, codeAcces };
  }

  /**
   * Le code d'accès vérifié (administrateurs) suit la session : la ligne
   * remplaçante reprend le drapeau de l'ancienne. Renvoie vrai s'il est posé.
   * Colonne absente (migration non passée) : faux, le code sera redemandé.
   */
  static async _transmettreCodeAcces(ancienId, nouveauId) {
    if (!ancienId || !nouveauId) return false;
    try {
      const [lignes] = await RefreshToken.sequelize.query(
        `UPDATE refresh_token n SET code_acces_verifie_le = a.code_acces_verifie_le
         FROM refresh_token a
         WHERE n.id = :nouveau AND a.id = :ancien AND a.code_acces_verifie_le IS NOT NULL
         RETURNING n.id`,
        { replacements: { nouveau: nouveauId, ancien: ancienId } },
      );
      return Array.isArray(lignes) && lignes.length > 0;
    } catch (err) {
      logger.warn('refresh_code_acces', { message: err.message });
      return false;
    }
  }

  /** Jeton remplacé par une rotation il y a moins de DELAI_GRACE_MS. */
  static async _dansLeDelaiDeGrace(token) {
    try {
      jwt.verify(token, jwtConfig.refreshSecret, jwtConfig.optionsVerification);
    } catch {
      return null;
    }
    const ligne = await RefreshToken.findOne({ where: { tokenHash: this._hash(token) } });
    if (!ligne || !ligne.rotatedAt) return null;
    if (Date.now() - new Date(ligne.rotatedAt).getTime() > DELAI_GRACE_MS) return null;
    if (ligne.expiresAt < new Date()) return null;
    // Le remplaçant a été fermé par une déconnexion : pas de grâce.
    if (ligne.remplacePar) {
      const suivant = await RefreshToken.findByPk(ligne.remplacePar);
      if (suivant && suivant.revokedAt && !suivant.rotatedAt) return null;
    }
    return ligne;
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
