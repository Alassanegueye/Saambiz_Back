const { Resend } = require('resend');
const logger = require('../utils/logger');

// Si la clé est absente, on n'instancie pas Resend : l'envoi d'e-mails est
// simplement désactivé (comme les notifications push sans Firebase). Cela permet
// de démarrer le backend en local sans compte Resend.
const _resendKey = process.env.RESEND_API_KEY;
const resend = _resendKey ? new Resend(_resendKey) : null;
if (!resend) {
  logger.warn('[RESEND] RESEND_API_KEY non défini — envoi d\'e-mails désactivé.');
}
// Expéditeur des e-mails transactionnels. En production, MAIL_FROM doit
// pointer sur un domaine vérifié chez Resend (ex. noreply@saambiz.sn).
const FROM = process.env.MAIL_FROM || 'SaamBiz <noreply@saambiz.sn>';
const isProd = process.env.NODE_ENV === 'production';

/**
 * Envoi générique — base de tous les helpers.
 * @param {{ to: string|string[], subject: string, html: string, attachments?: Array }} opts
 */
async function sendEmail({ to, subject, html, attachments = [] }) {
  // E-mails désactivés (clé absente) → on ignore proprement sans planter.
  if (!resend) {
    logger.warn('[RESEND] e-mail ignoré (service désactivé)', { subject });
    return null;
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
    ...(formattedAttachments.length > 0 && { attachments: formattedAttachments })
  };

  const { data, error } = await resend.emails.send(payload);

  if (error) {
    logger.error('resend:send', { error });
    throw new Error(error.message);
  }

  const dest = Array.isArray(to) ? to[0] : to;
  if (isProd) {
    logger.info('resend:sent', { domain: dest.split('@')[1] ?? '?', subject });
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
    subject: '✅ Votre abonnement SaamBiz est actif',
    html: template({ nom, montant, dateDebut, dateFin })
  });
}

/**
 * Rappel d'expiration d'abonnement (envoyé par le cron job)
 */
async function sendAbonnementExpiration({ to, nom, dateFin, joursRestants }) {
  const template = require('../templates/mail/abonnementExpiration.template');
  const emoji = joursRestants <= 3 ? '🚨' : '⏰';
  return sendEmail({
    to,
    subject: `${emoji} Votre abonnement expire dans ${joursRestants} jour${joursRestants > 1 ? 's' : ''}`,
    html: template({ nom, dateFin, joursRestants })
  });
}

// MED-03 : email de vérification à l'inscription
async function sendVerificationEmail({ to, nom, code }) {
  const template = require('../templates/mail/verificationEmail.template');
  return sendEmail({
    to,
    subject: 'Votre code de vérification SaamBiz',
    html: template({ nom, code })
  });
}

/**
 * Email d'accueil pour un nouvel administrateur créé par le super admin
 */
async function sendNewAdminEmail({ to, nom, prenom, email, password }) {
  const template = require('../templates/mail/newAdmin.template');
  return sendEmail({
    to,
    subject: 'Vos accès administrateur — Jëndal',
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
    subject: `🛒 Nouvelle commande ${referenceCommande} — Jëndal`,
    html: template({ nom, referenceCommande, montantTotal })
  });
}

module.exports = {
  sendEmail,
  sendOtpEmail,
  sendWelcomeEmail,
  sendAbonnementConfirme,
  sendAbonnementExpiration,
  sendVerificationEmail,
  sendNewAdminEmail,
  sendNouvelleCommandeEmail,
};
