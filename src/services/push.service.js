const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const DeviceToken = require('../models/deviceToken.model');
const logger = require('../utils/logger');

// Initialise Firebase Admin une seule fois au démarrage
let fcmReady = false;

try {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    const serviceAccount = JSON.parse(raw);
    if (!getApps().length) {
      initializeApp({ credential: cert(serviceAccount) });
    }
    fcmReady = true;
    logger.info('[FCM] Firebase Admin initialisé');
  } else {
    logger.warn('[FCM] FIREBASE_SERVICE_ACCOUNT_JSON non défini — notifications push désactivées');
  }
} catch (err) {
  logger.error('[FCM] Erreur initialisation Firebase Admin', { message: err.message });
}

/**
 * Envoie une notification push à un ou plusieurs utilisateurs via leurs device tokens FCM.
 * @param {string|string[]} utilisateurIds
 * @param {{ title: string, body: string, data?: Record<string,string> }} payload
 */
async function sendPushToUsers(utilisateurIds, { title, body, data = {} }) {
  if (!fcmReady) return;

  const ids = Array.isArray(utilisateurIds) ? utilisateurIds : [utilisateurIds];

  const rows = await DeviceToken.findAll({
    where: { utilisateurId: ids },
    attributes: ['token']
  });

  if (!rows.length) return;

  const tokens = rows.map(r => r.token);

  // data doit être Record<string,string> pour FCM
  const safeData = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, String(v)])
  );

  try {
    const response = await getMessaging().sendEachForMulticast({
      notification: { title, body },
      data: safeData,
      tokens
    });

    // Supprimer les tokens invalides (app désinstallée, token expiré)
    const invalidTokens = [];
    response.responses.forEach((res, idx) => {
      if (!res.success) {
        const code = res.error?.code;
        if (
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/registration-token-not-registered'
        ) {
          invalidTokens.push(tokens[idx]);
        }
      }
    });

    if (invalidTokens.length) {
      await DeviceToken.destroy({ where: { token: invalidTokens } });
      logger.info(`[FCM] ${invalidTokens.length} token(s) invalide(s) supprimé(s)`);
    }

    logger.info(`[FCM] ${response.successCount}/${tokens.length} notif(s) envoyée(s) — "${title}"`);
  } catch (err) {
    logger.error('[FCM] Erreur envoi multicast', { message: err.message });
  }
}

/**
 * Enregistre ou met à jour le token FCM d'un appareil.
 * Un utilisateur peut avoir plusieurs appareils (multi-device).
 * @param {string} utilisateurId
 * @param {string} token
 * @param {'android'|'ios'|'web'} platform
 */
async function saveDeviceToken(utilisateurId, token, platform = 'android') {
  await DeviceToken.upsert(
    { utilisateurId, token, platform },
    { conflictFields: ['token'] }
  );
}

/**
 * Supprime tous les tokens FCM d'un utilisateur (ex: lors du logout).
 * @param {string} utilisateurId
 * @param {string|null} token — si fourni, supprime uniquement ce token précis
 */
async function removeDeviceToken(utilisateurId, token = null) {
  const where = token
    ? { utilisateurId, token }
    : { utilisateurId };
  await DeviceToken.destroy({ where });
}

module.exports = { sendPushToUsers, saveDeviceToken, removeDeviceToken };
