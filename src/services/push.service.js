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

/** Canal Android créé par l'application (FcmService) : les deux doivent correspondre. */
const CANAL_ANDROID = 'saambiz_push_channel';

/**
 * Image d'une notification. Les fichiers passent par Cloudinary : on demande
 * à Cloudinary une version légère (≤ 1024 px, JPEG compressé), car Android
 * abandonne l'image d'une notification au-delà d'1 Mo environ. Une adresse
 * https hors Cloudinary est gardée telle quelle ; tout le reste est ignoré.
 */
function imagePourPush(url) {
  const u = String(url || '').trim();
  if (!/^https:\/\//.test(u)) return undefined;
  if (/res\.cloudinary\.com\/.+\/image\/upload\//.test(u)) {
    return u.replace('/image/upload/', '/image/upload/c_limit,w_1024,h_1024,q_auto:good,f_jpg/');
  }
  return u;
}

/**
 * Envoie une notification push à un ou plusieurs utilisateurs via leurs device tokens FCM.
 * @param {string|string[]} utilisateurIds
 * @param {{ title: string, body: string, data?: Record<string,string>, image?: string }} payload
 *   `image` : URL https d'une image affichée dans la notification — le logo
 *   de la boutique quand la notification vient d'une boutique.
 */
async function sendPushToUsers(utilisateurIds, { title, body, data = {}, image }) {
  if (!fcmReady) return;

  const ids = Array.isArray(utilisateurIds) ? utilisateurIds : [utilisateurIds];

  const rows = await DeviceToken.findAll({
    where: { utilisateurId: ids },
    attributes: ['token']
  });

  if (!rows.length) return;

  const tokens = rows.map(r => r.token);

  // data doit être Record<string,string> pour FCM
  const imageUrl = imagePourPush(image);
  const safeData = Object.fromEntries(
    Object.entries({ ...data, ...(imageUrl && { image: imageUrl }) })
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => [k, String(v)])
  );

  try {
    const response = await getMessaging().sendEachForMulticast({
      notification: { title, body, ...(imageUrl && { imageUrl }) },
      data: safeData,

      // Priorité haute : sans elle, Android garde le message en file d'attente
      // quand le téléphone est en veille, et la promo arrive des dizaines de
      // minutes plus tard. Le canal doit être celui créé par l'application.
      android: {
        priority: 'high',
        notification: {
          channelId: CANAL_ANDROID,
          sound: 'default',
          ...(imageUrl && { imageUrl }),
        },
      },

      // iOS : priorité 10 = livraison immédiate ; `sound` fait apparaître la
      // bannière téléphone verrouillé ; `mutable-content` laisse iOS
      // télécharger l'image.
      apns: {
        headers: { 'apns-priority': '10' },
        payload: { aps: { sound: 'default', 'mutable-content': 1 } },
        ...(imageUrl && { fcmOptions: { imageUrl } }),
      },

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

module.exports = { sendPushToUsers, saveDeviceToken, removeDeviceToken, imagePourPush };
