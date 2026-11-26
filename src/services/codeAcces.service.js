const bcrypt = require('bcryptjs');
const { QueryTypes } = require('sequelize');
const sequelize = require('../config/db');
const { bcryptConfig } = require('../config/security');
const Utilisateur = require('../models/utilisateur.model');
const RefreshTokenService = require('./refreshToken.service');
const { jetonAcces } = require('./jetonAcces');
const {
  AppError, ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError,
} = require('../errors/AppError');
const {
  COMPTES_CODE_FIXE, REGLE_CODE, ECHECS_MAX, BLOCAGE_MS, ROLES_ADMIN,
} = require('../config/codeAcces');

/**
 * Le code d'accès à quatre chiffres des administrateurs (portail KODAFRIK).
 *
 *   - vérifié par le portail après le mot de passe : la session est marquée,
 *     et le jeton d'accès renvoyé porte `ca` ;
 *   - EXIGÉ par le serveur : isAdmin refuse toute route /admin sans `ca` ;
 *   - 5 échecs → bloqué 15 min ;
 *   - changé depuis le dashboard Kodafrik : les sessions déjà vérifiées du
 *     compte perdent leur drapeau, le nouveau code est redemandé ;
 *   - comptes au code fixe (config/codeAcces.js) : ce code-là seul, jamais
 *     modifiable.
 */

const emailDe = (u) => String(u?.email || '').trim().toLowerCase();
const hashFixe = (u) => COMPTES_CODE_FIXE[emailDe(u)] || null;
const estFixe = (u) => Boolean(hashFixe(u));

async function ligneDe(utilisateurId) {
  const [ligne] = await sequelize.query(
    'SELECT code_hash, echecs, bloque_jusqua FROM code_acces_admin WHERE utilisateur_id = :id',
    { replacements: { id: utilisateurId }, type: QueryTypes.SELECT },
  );
  return ligne || null;
}

function minutesRestantes(jusqua, maintenant) {
  return Math.max(1, Math.ceil((new Date(jusqua).getTime() - maintenant) / 60000));
}

class CodeAccesService {
  static estFixe(utilisateur) {
    return estFixe(utilisateur);
  }

  /**
   * Vérifie le code de la personne connectée.
   * @returns {Promise<{valide: true, token: string}>} un jeton d'accès portant `ca`
   */
  static async verifier(utilisateur, code, { refreshToken = null, maintenant = Date.now() } = {}) {
    if (!ROLES_ADMIN.includes(utilisateur?.role)) {
      throw new ForbiddenError("Le code d'accès concerne les administrateurs.", { code: 'CODE_ACCES_HORS_ADMIN' });
    }
    if (!REGLE_CODE.test(String(code ?? ''))) {
      throw new ValidationError("Le code d'accès fait exactement quatre chiffres.", [], { code: 'CODE_ACCES_FORMAT' });
    }

    const ligne = await ligneDe(utilisateur.id);
    const hash = hashFixe(utilisateur) || ligne?.code_hash;
    if (!hash) {
      throw new ForbiddenError(
        "Aucun code d'accès n'est défini pour ce compte. Demandez à un super administrateur de vous en attribuer un.",
        { code: 'CODE_ACCES_NON_DEFINI' },
      );
    }
    if (ligne?.bloque_jusqua && new Date(ligne.bloque_jusqua).getTime() > maintenant) {
      throw new AppError(
        `Trop d'essais. Réessayez dans ${minutesRestantes(ligne.bloque_jusqua, maintenant)} min.`,
        423,
        { code: 'CODE_ACCES_BLOQUE' },
      );
    }

    const valide = await bcrypt.compare(String(code), hash);
    if (!valide) {
      const echecs = (ligne?.echecs || 0) + 1;
      const bloque = echecs >= ECHECS_MAX;
      // Compte au code fixe sans ligne : elle est créée pour compter les échecs.
      await sequelize.query(
        `INSERT INTO code_acces_admin (utilisateur_id, code_hash, echecs, bloque_jusqua)
         VALUES (:id, :hash, :echecs, :jusqua)
         ON CONFLICT (utilisateur_id) DO UPDATE SET echecs = :echecs, bloque_jusqua = :jusqua`,
        {
          replacements: {
            id: utilisateur.id,
            hash,
            echecs: bloque ? 0 : echecs,
            jusqua: bloque ? new Date(maintenant + BLOCAGE_MS) : null,
          },
        },
      );
      if (bloque) {
        throw new AppError(`Trop d'essais. Réessayez dans ${Math.round(BLOCAGE_MS / 60000)} min.`, 423, { code: 'CODE_ACCES_BLOQUE' });
      }
      throw new UnauthorizedError("Code d'accès incorrect.", { code: 'CODE_ACCES_INCORRECT' });
    }

    if (ligne && (ligne.echecs || ligne.bloque_jusqua)) {
      await sequelize.query(
        'UPDATE code_acces_admin SET echecs = 0, bloque_jusqua = NULL WHERE utilisateur_id = :id',
        { replacements: { id: utilisateur.id } },
      );
    }

    // La session est marquée : ses jetons suivants (rafraîchissement) gardent
    // le code vérifié. Le jeton présenté doit être une session ouverte du compte.
    if (refreshToken) {
      await sequelize.query(
        `UPDATE refresh_token SET code_acces_verifie_le = NOW()
         WHERE token_hash = :h AND utilisateur_id = :id AND revoked_at IS NULL`,
        { replacements: { h: RefreshTokenService._hash(String(refreshToken)), id: utilisateur.id } },
      );
    }

    return { valide: true, token: jetonAcces(utilisateur, { codeAcces: true }) };
  }

  /** Pose (ou change) le code d'un administrateur. */
  static async definir(cibleId, code, { auteurId = null } = {}) {
    if (!REGLE_CODE.test(String(code ?? ''))) {
      throw new ValidationError("Le code d'accès fait exactement quatre chiffres.", [], { code: 'CODE_ACCES_FORMAT' });
    }
    const cible = await Utilisateur.findByPk(cibleId);
    if (!cible || !ROLES_ADMIN.includes(cible.role)) throw new NotFoundError('Administrateur introuvable.');
    if (estFixe(cible)) {
      throw new ConflictError("Le code d'accès de ce compte est fixé et ne peut pas être changé.", { code: 'CODE_ACCES_FIXE' });
    }

    const hash = await bcrypt.hash(String(code), bcryptConfig.saltRounds);
    await sequelize.query(
      `INSERT INTO code_acces_admin (utilisateur_id, code_hash, echecs, bloque_jusqua, modifie_le, modifie_par)
       VALUES (:id, :hash, 0, NULL, NOW(), :auteur)
       ON CONFLICT (utilisateur_id) DO UPDATE
         SET code_hash = :hash, echecs = 0, bloque_jusqua = NULL, modifie_le = NOW(), modifie_par = :auteur`,
      { replacements: { id: cible.id, hash, auteur: auteurId } },
    );
    // L'ancien code ne vaut plus : les sessions déjà vérifiées le redemandent.
    await sequelize.query(
      'UPDATE refresh_token SET code_acces_verifie_le = NULL WHERE utilisateur_id = :id AND code_acces_verifie_le IS NOT NULL',
      { replacements: { id: cible.id } },
    );
    return { id: cible.id };
  }
}

module.exports = CodeAccesService;
