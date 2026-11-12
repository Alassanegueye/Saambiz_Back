const fs = require('fs');
const path = require('path');
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const DeviceToken = require('../models/deviceToken.model');
const logger = require('../utils/logger');

// Initialise Firebase Admin une seule fois au démarrage
let fcmReady = false;

/**
 * Lit le compte de service, quelle que soit la forme qu'il a prise en route.
 *
 * Le JSON de Firebase contient une clé privée PEM, donc des retours à la
 * ligne. Un fichier `.env` ne sait pas porter une valeur multiligne : selon
 * l'outil qui le lit, elle arrive tronquée à la première ligne, ou avec des
 * `\n` restés littéraux que `JSON.parse` refuse. C'est l'échec le plus
 * courant, et il ne dit rien de lui-même — d'où ce qui suit.
 *
 * Trois formes sont acceptées, dans cet ordre :
 *   1. un CHEMIN vers le fichier téléchargé depuis Firebase (le plus sûr :
 *      aucun passage par l'environnement, donc rien à échapper) ;
 *   2. du BASE64 — une seule ligne, insensible aux retours à la ligne ;
 *   3. le JSON brut, avec rattrapage des `\n` laissés littéraux dans la clé.
 */
function lireCompteDeService(valeur) {
  const v = String(valeur || '').trim();
  if (!v) return null;

  // 1. Chemin de fichier
  if (!v.startsWith('{') && !/^[A-Za-z0-9+/=\s]+$/.test(v)) {
    const chemin = path.isAbsolute(v) ? v : path.resolve(process.cwd(), v);
    if (!fs.existsSync(chemin)) {
      throw new Error(`chemin indiqué mais fichier introuvable : ${chemin}`);
    }
    return { compte: JSON.parse(fs.readFileSync(chemin, 'utf8')), forme: 'fichier' };
  }

  // 2. Base64
  if (!v.startsWith('{')) {
    const decode = Buffer.from(v, 'base64').toString('utf8');
    if (!decode.trim().startsWith('{')) {
      throw new Error('valeur ni JSON, ni base64 d\'un JSON, ni chemin existant');
    }
    return { compte: JSON.parse(decode), forme: 'base64' };
  }

  // 3. JSON brut. Les `\n` de la clé privée survivent rarement au .env :
  // s'ils sont restés littéraux, JSON.parse échoue, et on réessaie en les
  // rétablissant.
  try {
    return { compte: JSON.parse(v), forme: 'json' };
  } catch (err) {
    const repare = v.replace(/\r?\n/g, '\\n');
    try {
      return { compte: JSON.parse(repare), forme: 'json (retours à la ligne rétablis)' };
    } catch {
      throw err; // on remonte l'erreur d'origine, plus parlante
    }
  }
}

try {
  const resultat = lireCompteDeService(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (resultat) {
    const { compte, forme } = resultat;
    if (!compte.private_key || !compte.client_email || !compte.project_id) {
      throw new Error(
        'JSON lu mais incomplet : project_id, client_email et private_key sont requis'
      );
    }
    // Gabarit recopié tel quel depuis .env.example : les trois champs sont
    // bien là, mais remplis de « ... ». L'initialisation passait, le journal
    // annonçait « Firebase Admin initialisé », et chaque envoi était refusé
    // plus tard sans que rien ne désigne la cause. Mieux vaut refuser ici.
    const gabarit = [compte.project_id, compte.client_email, compte.private_key].find((v) =>
      String(v).includes('...')
    );
    if (gabarit) {
      throw new Error(
        'gabarit non remplacé : le compte de service contient encore des « ... » ' +
          '— télécharger la vraie clé depuis Firebase Console → Comptes de service'
      );
    }
    if (!getApps().length) {
      initializeApp({ credential: cert(compte) });
    }
    fcmReady = true;
    // Le projet est journalisé : un compte de service du MAUVAIS projet
    // s'initialise sans broncher et n'atteint jamais vos téléphones.
    logger.info('[FCM] Firebase Admin initialisé', {
      projet: compte.project_id,
      compte: compte.client_email,
      forme,
    });
  } else {
    logger.warn('[FCM] FIREBASE_SERVICE_ACCOUNT_JSON non défini — notifications push désactivées');
  }
} catch (err) {
  const brut = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '');
  logger.error('[FCM] Erreur initialisation Firebase Admin', {
    message: err.message,
    // De quoi diagnostiquer sans recopier la clé privée dans le journal.
    longueur: brut.length,
    commencePar: brut.slice(0, 18),
    contientRetourLigne: /\r?\n/.test(brut),
    ressembleAUnChemin: !brut.trim().startsWith('{') && brut.includes('/'),
  });
}

/** Canal Android créé par l'application (FcmService) : les deux doivent correspondre. */
const CANAL_ANDROID = 'saambiz_push_channel';

/**
 * Empreinte d'un jeton d'appareil pour les journaux : les 8 derniers
 * caractères, rien de plus.
 *
 * Un jeton FCM complet dans un fichier de log, c'est une donnée d'appareil
 * recopiée sur disque, exportée vers l'agrégateur, et lue par qui sait lire
 * les journaux. Huit caractères suffisent à reconnaître « encore le même
 * téléphone » d'une ligne à l'autre, qui est tout ce qu'on cherche ici.
 */
const empreinte = (jeton) => `…${String(jeton || '').slice(-8)}`;

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
  const ids = Array.isArray(utilisateurIds) ? utilisateurIds : [utilisateurIds];

  // Premier silence possible : sans compte de service, l'envoi ne part jamais.
  // L'avertissement existait au démarrage seulement — invisible une fois le
  // serveur lancé, et introuvable quand on cherche pourquoi rien n'arrive.
  if (!fcmReady) {
    logger.warn('[FCM] envoi ignoré : Firebase Admin non initialisé', {
      raison: process.env.FIREBASE_SERVICE_ACCOUNT_JSON
        ? 'FIREBASE_SERVICE_ACCOUNT_JSON présent mais illisible (voir l\'erreur au démarrage)'
        : 'FIREBASE_SERVICE_ACCOUNT_JSON absent de l\'environnement',
      destinataires: ids.length,
      titre: title,
    });
    return;
  }

  const rows = await DeviceToken.findAll({
    where: { utilisateurId: ids },
    attributes: ['token', 'platform']
  });

  // Deuxième silence possible, et le plus fréquent : personne n'a d'appareil
  // enregistré. Le téléphone n'a jamais appelé /notifications/device-token —
  // parce que l'autorisation a été refusée, parce que les fichiers Firebase
  // manquaient dans le build, ou parce que l'utilisateur ne s'est pas
  // reconnecté depuis.
  if (!rows.length) {
    logger.warn('[FCM] envoi ignoré : aucun appareil enregistré', {
      destinataires: ids.length,
      utilisateurs: ids,
      titre: title,
    });
    return;
  }

  const tokens = rows.map(r => r.token);
  const parPlateforme = rows.reduce((acc, r) => {
    acc[r.platform || 'inconnue'] = (acc[r.platform || 'inconnue'] || 0) + 1;
    return acc;
  }, {});
  logger.info('[FCM] envoi en préparation', {
    destinataires: ids.length,
    appareils: tokens.length,
    parPlateforme,
    titre: title,
  });

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
      // bannière téléphone verrouillé.
      //
      // `mutable-content: 1` et `fcmOptions.imageUrl` sont envoyés, mais
      // ATTENTION : contrairement à Android, iOS NE TÉLÉCHARGE PAS l'image de
      // lui-même. `mutable-content` autorise seulement une « Notification
      // Service Extension » de l'application à modifier la notification avant
      // affichage ; sans cette extension — et l'application n'en a pas —
      // l'iPhone affiche le titre et le texte, sans le logo de la boutique.
      //
      // Les deux clés sont conservées : elles ne coûtent rien, et le jour où
      // l'extension sera ajoutée à la cible iOS, l'image apparaîtra sans
      // toucher au serveur. Ne pas les retirer en croyant à du code mort.
      apns: {
        headers: { 'apns-priority': '10' },
        payload: { aps: { sound: 'default', 'mutable-content': 1 } },
        ...(imageUrl && { fcmOptions: { imageUrl } }),
      },

      tokens
    });

    // Supprimer les tokens invalides (app désinstallée, token expiré)
    const invalidTokens = [];
    const echecs = [];
    response.responses.forEach((res, idx) => {
      if (!res.success) {
        const code = res.error?.code;
        echecs.push({
          appareil: empreinte(tokens[idx]),
          plateforme: rows[idx]?.platform || 'inconnue',
          code: code || 'inconnu',
          message: res.error?.message,
        });
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

    // Troisième silence possible, et le plus trompeur : FCM répond 200 et
    // compte les échecs un par un. `successCount` à 0 ne levait aucune
    // exception — le journal disait « 0/3 envoyées » sans dire pourquoi.
    //
    // Les codes à connaître :
    //   messaging/third-party-auth-error  → clé APNs absente ou invalide
    //                                        dans Firebase : c'est la cause
    //                                        habituelle d'un iPhone muet ;
    //   messaging/registration-token-not-registered → application
    //                                        désinstallée, jeton périmé ;
    //   messaging/invalid-argument        → charge utile refusée (canal,
    //                                        image trop lourde, data non
    //                                        textuelle).
    if (echecs.length) {
      logger.error('[FCM] envois refusés par Firebase', {
        titre: title,
        refuses: echecs.length,
        sur: tokens.length,
        detail: echecs,
      });
    }

    logger.info(`[FCM] ${response.successCount}/${tokens.length} notif(s) envoyée(s) — "${title}"`);
  } catch (err) {
    // L'exception ne survient que si l'appel lui-même échoue (réseau,
    // identifiants refusés). Les refus par jeton, eux, passent par `echecs`.
    logger.error('[FCM] Erreur envoi multicast', {
      message: err.message,
      code: err.code,
      titre: title,
      appareils: tokens.length,
    });
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
  // Sans cette trace, impossible de distinguer « le serveur n'envoie pas » de
  // « le téléphone ne s'est jamais annoncé ». C'est la première chose à
  // regarder quand quelqu'un dit ne rien recevoir.
  logger.info('[FCM] appareil enregistré', {
    utilisateur: utilisateurId,
    plateforme: platform,
    appareil: empreinte(token),
  });
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
  const retires = await DeviceToken.destroy({ where });
  logger.info('[FCM] appareil(s) retiré(s)', {
    utilisateur: utilisateurId,
    appareil: token ? empreinte(token) : 'tous',
    retires,
  });
  return retires;
}

module.exports = { sendPushToUsers, saveDeviceToken, removeDeviceToken, imagePourPush };
