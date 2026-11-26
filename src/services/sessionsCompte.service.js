const crypto = require('crypto');
const { QueryTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * Les sessions de compte : la vie d'un compte, de sa création à sa
 * suppression (migration 20261127_sessions_compte.sql).
 *
 *   - à la CRÉATION d'un compte (inscription, Google / Apple, création depuis
 *     l'administration), une session s'ouvre. Si un compte précédent, FERMÉ,
 *     avait le même e-mail ou le même téléphone, c'est la même personne : le
 *     nouveau compte reprend son `personne_id` ;
 *   - à la SUPPRESSION, la session se ferme, et l'e-mail et le téléphone du
 *     compte sont libérés (`supprime.<id>.<adresse>`) : la personne peut
 *     recréer un compte avec la même adresse ;
 *   - toutes les sessions d'une personne se retrouvent par son `personne_id`.
 */

/** Adresse libérée d'un compte supprimé : reste une adresse valide, garde l'originale. */
const adresseLiberee = (utilisateur) => {
  const [local, domaine] = String(utilisateur.email).split('@');
  return `supprime.${String(utilisateur.id).slice(0, 8)}.${local}@${domaine}`.slice(0, 255);
};
const PREFIXE_LIBERE = /^supprime\.[0-9a-f]{8}\./i;

/**
 * Avant de créer un compte : son identifiant, sa personne et sa session.
 * À passer à `Utilisateur.create({ id, personneId, idSession, ... })`.
 */
async function preparer({ email, telephone } = {}, { transaction } = {}) {
  const id = crypto.randomUUID();
  const [precedente] = await sequelize.query(
    `SELECT personne_id FROM session_compte
     WHERE fermee_le IS NOT NULL
       AND ((:email <> '' AND lower(email) = :email) OR (:tel <> '' AND telephone = :tel))
     ORDER BY fermee_le DESC
     LIMIT 1`,
    {
      replacements: { email: String(email || '').trim().toLowerCase(), tel: String(telephone || '') },
      type: QueryTypes.SELECT,
      transaction,
    },
  );
  return { id, personneId: precedente?.personne_id || id, idSession: crypto.randomUUID() };
}

/** Le compte vient d'être créé : sa session s'ouvre. */
async function ouvrir(utilisateur, { transaction } = {}) {
  await sequelize.query(
    `INSERT INTO session_compte (id_session, personne_id, utilisateur_id, role, email, telephone)
     VALUES (:idSession, :personneId, :id, :role, :email, :telephone)
     ON CONFLICT (id_session) DO NOTHING`,
    {
      replacements: {
        idSession: utilisateur.idSession,
        personneId: utilisateur.personneId || utilisateur.id,
        id: utilisateur.id,
        role: utilisateur.role || null,
        email: utilisateur.email || null,
        telephone: utilisateur.telephone || null,
      },
      transaction,
    },
  );
}

/**
 * Le compte est supprimé : sa session se ferme, son e-mail et son téléphone
 * sont libérés. À appeler AVANT la suppression elle-même (destroy ou
 * compteSupprime), dans la même transaction.
 */
async function fermer(utilisateur, motif = null, { transaction } = {}) {
  const idSession = utilisateur.idSession || crypto.randomUUID();
  const emailOrigine = PREFIXE_LIBERE.test(utilisateur.email || '') ? null : utilisateur.email;
  // Upsert : un compte sans session (antérieur à la migration) en reçoit une, fermée.
  await sequelize.query(
    `INSERT INTO session_compte (id_session, personne_id, utilisateur_id, role, email, telephone, ouverte_le, fermee_le, motif_fermeture)
     VALUES (:idSession, :personneId, :id, :role, :email, :telephone, COALESCE(:creeLe, NOW()), NOW(), :motif)
     ON CONFLICT (id_session) DO UPDATE
       SET fermee_le = COALESCE(session_compte.fermee_le, EXCLUDED.fermee_le),
           motif_fermeture = COALESCE(session_compte.motif_fermeture, EXCLUDED.motif_fermeture)`,
    {
      replacements: {
        idSession,
        personneId: utilisateur.personneId || utilisateur.id,
        id: utilisateur.id,
        role: utilisateur.role || null,
        email: emailOrigine,
        telephone: utilisateur.telephone || null,
        creeLe: utilisateur.createdAt || null,
        motif: motif ? String(motif).slice(0, 500) : null,
      },
      transaction,
    },
  );
  const changes = {};
  if (!utilisateur.idSession) changes.idSession = idSession;
  if (!utilisateur.personneId) changes.personneId = utilisateur.id;
  if (emailOrigine) {
    changes.email = adresseLiberee(utilisateur);
    changes.telephone = null;
  }
  if (Object.keys(changes).length) await utilisateur.update(changes, { transaction, hooks: false });
}

/** Toutes les sessions de la personne de ce compte, la plus récente d'abord. */
async function sessionsDe(utilisateurId) {
  const [compte] = await sequelize.query(
    'SELECT id, personne_id FROM utilisateur WHERE id = :id',
    { replacements: { id: utilisateurId }, type: QueryTypes.SELECT },
  );
  if (!compte) return null;
  const sessions = await sequelize.query(
    `SELECT s.id_session, s.utilisateur_id, s.role, s.email, s.telephone, s.ouverte_le, s.fermee_le, s.motif_fermeture,
            (s.fermee_le IS NULL) AS ouverte
     FROM session_compte s
     WHERE s.personne_id = :personne
     ORDER BY s.ouverte_le DESC`,
    { replacements: { personne: compte.personne_id || compte.id }, type: QueryTypes.SELECT },
  );
  return { personneId: compte.personne_id || compte.id, sessions };
}

module.exports = { preparer, ouvrir, fermer, sessionsDe, adresseLiberee, PREFIXE_LIBERE };
