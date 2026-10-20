const { Resend } = require('resend');
const logger = require('../utils/logger');

const isProd = process.env.NODE_ENV === 'production';

// Si la clé est absente, on n'instancie pas Resend : l'envoi d'e-mails est
// désactivé. Acceptable en local, PAS en production : l'API répondait alors
// « code envoyé » alors que rien ne partait, et le client attendait un email
// qui n'arriverait jamais. En production, un envoi sans clé lève désormais une
// erreur (l'application affiche « le code n'a pas pu être envoyé »).
const _resendKey = process.env.RESEND_API_KEY;
const resend = _resendKey ? new Resend(_resendKey) : null;
if (!resend) {
  logger.error('[RESEND] RESEND_API_KEY non défini — aucun e-mail ne sera envoyé.');
}
// Expéditeur des e-mails transactionnels : il DOIT appartenir à un domaine
// vérifié chez Resend (ici send.saambiz.com), sinon Resend refuse l'envoi.
const FROM = process.env.MAIL_FROM || 'SaamBiz <noreply@send.saambiz.com>';
// Adresse de réponse facultative (support).
const REPLY_TO = process.env.MAIL_REPLY_TO || process.env.SUPPORT_EMAIL || undefined;

/** Version texte d'un email HTML : améliore la délivrabilité (filtres anti-spam). */
function versTexte(html) {
  return String(html)
    .replace(/<(style|title)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<div style="display:none[^>]*>[\s\S]*?<\/div>/i, '')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/td>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

/**
 * Envoi générique — base de tous les helpers.
 * @param {{ to: string|string[], subject: string, html: string, text?: string, attachments?: Array }} opts
 */
async function sendEmail({ to, subject, html, text, attachments = [] }) {
  if (!resend) {
    // Plus de « succès » silencieux : sur Render le serveur tourne avec
    // NODE_ENV=development, si bien que l'ancienne garde (production
    // seulement) laissait l'API répondre « code envoyé » sans rien envoyer.
    // Seuls les tests automatisés ignorent l'envoi.
    if (process.env.NODE_ENV === 'test') return null;
    throw new Error('Service e-mail non configuré (RESEND_API_KEY manquante).');
  }

  const formattedAttachments = attachments.map(att => ({
    filename: att.filename,
    content: att.content   // Buffer ou base64
  }));

  const payload = {
    from: FROM,
    to,
    subject,
    html,
    text: text || versTexte(html),
    ...(REPLY_TO && { replyTo: REPLY_TO }),
    ...(formattedAttachments.length > 0 && { attachments: formattedAttachments })
  };

  let reponse;
  try {
    reponse = await resend.emails.send(payload);
  } catch (err) {
    logger.error('resend:send (réseau)', { message: err.message });
    throw err;
  }
  const { data, error } = reponse || {};

  if (error) {
    // Cas typiques : domaine de MAIL_FROM non vérifié, clé invalide, quota.
    logger.error('resend:send', { error, from: FROM });
    throw new Error(error.message || 'Envoi refusé par Resend.');
  }

  const dest = Array.isArray(to) ? to[0] : to;
  if (isProd) {
    logger.info('resend:sent', { domain: dest.split('@')[1] ?? '?', subject, id: data?.id });
  } else {
    logger.info(`[resend][dev] → ${dest} | ${subject} (id: ${data?.id})`);
  }

  return data;
}

/**
 * Email OTP de réinitialisation de mot de passe
 */
async function sendOtpEmail({ to, nom, otp }) {
  const template = require('../templates/mail/otpPassword.template');
  return sendEmail({
    to,
    subject: 'Votre code de réinitialisation — SaamBiz',
    html: template({ nom, otp })
  });
}

/**
 * Email de bienvenue à l'inscription (Vendeur ou Acheteur)
 */
async function sendWelcomeEmail({ to, nom, prenom, role }) {
  const template = require('../templates/mail/welcome.template');
  return sendEmail({
    to,
    subject: 'Bienvenue sur SaamBiz',
    html: template({ nom, prenom, role })
  });
}

/**
 * Confirmation de paiement / activation abonnement (Vendeur)
 */
async function sendAbonnementConfirme({ to, nom, montant, dateDebut, dateFin }) {
  const template = require('../templates/mail/abonnementConfirme.template');
  return sendEmail({
    to,
    subject: 'Votre abonnement SaamBiz est actif',
    html: template({ nom, montant, dateDebut, dateFin })
  });
}

/**
 * Rappel d'expiration d'abonnement (envoyé par le cron job)
 */
async function sendAbonnementExpiration({ to, nom, dateFin, joursRestants }) {
  const template = require('../templates/mail/abonnementExpiration.template');
  return sendEmail({
    to,
    subject: `Votre abonnement SaamBiz expire dans ${joursRestants} jour${joursRestants > 1 ? 's' : ''}`,
    html: template({ nom, dateFin, joursRestants })
  });
}

// MED-03 : email de vérification à l'inscription
async function sendVerificationEmail({ to, nom, code, minutes }) {
  const template = require('../templates/mail/verificationEmail.template');
  return sendEmail({
    to,
    // Le code dans l'objet : lisible depuis la notification, sans ouvrir l'email.
    subject: `${code} est votre code de vérification SaamBiz`,
    html: template({ nom, code, minutes })
  });
}

/**
 * Email d'accueil pour un nouvel administrateur créé par le super admin
 */
async function sendNewAdminEmail({ to, nom, prenom, email, password }) {
  const template = require('../templates/mail/newAdmin.template');
  return sendEmail({
    to,
    subject: 'Vos accès administrateur — SaamBiz',
    html: template({ nom, prenom, email, password }),
  });
}

/**
 * Email au vendeur lors de la création d'une nouvelle commande
 */
async function sendNouvelleCommandeEmail({ to, nom, referenceCommande, montantTotal }) {
  const template = require('../templates/mail/nouvelleCommande.template');
  return sendEmail({
    to,
    subject: `Nouvelle commande ${referenceCommande} — SaamBiz`,
    html: template({ nom, referenceCommande, montantTotal })
  });
}

/** État du service, pour /health : des indications, jamais la clé. */
function etatEmail() {
  return {
    configure: Boolean(resend),
    expediteur: FROM.replace(/^.*<|>.*$/g, '').split('@')[1] || null,
  };
}

/** Accès d'un client ou vendeur créé depuis le dashboard admin. */
async function sendAccesUtilisateurEmail({ to, prenom, nom, email, password, role }) {
  const template = require('../templates/mail/accesUtilisateur.template');
  return sendEmail({
    to,
    subject: 'Vos accès SaamBiz',
    html: template({ prenom, nom, email, password, role }),
  });
}

module.exports = {
  sendAccesUtilisateurEmail,
  etatEmail,
  sendEmail,
  sendOtpEmail,
  sendWelcomeEmail,
  sendAbonnementConfirme,
  sendAbonnementExpiration,
  sendVerificationEmail,
  sendNewAdminEmail,
  sendNouvelleCommandeEmail,
};
