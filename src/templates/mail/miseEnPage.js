// ─────────────────────────────────────────────────────────────
// templates/mail/miseEnPage.js
// En-tête et cadre communs aux emails SaamBiz (même construction que ceux de
// Yobante Boutique) : bandeau bleu marine avec le pictogramme de
// l'application, carte blanche, pied de page.
// ─────────────────────────────────────────────────────────────

// Le pictogramme est servi par l'API elle-même (Backend/public/email/, route
// /email/pictogramme.png) et, en secours, par le site vitrine. Une image
// distante plutôt qu'en pièce jointe : Gmail et Outlook masquent souvent les
// images intégrées en base64.
const sansSlashFinal = (u) => String(u || '').replace(/\/+$/, '');
const BASE_PUBLIQUE =
  process.env.API_PUBLIC_URL ||
  process.env.RENDER_EXTERNAL_URL || // fourni automatiquement par Render
  process.env.VITRINE_BASE_URL ||
  'https://saambiz.com';
const LOGO_URL = process.env.MAIL_LOGO_URL || `${sansSlashFinal(BASE_PUBLIQUE)}/email/pictogramme.png`;

const NAVY = '#0D1B3D';
const OR = '#F2B705';
const POLICE = 'font-family:Arial,Helvetica,sans-serif';

const echapper = (valeur) =>
  String(valeur ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Bandeau bleu marine : pictogramme + « SaamBiz ». */
const entete = () => `
    <div style="background:${NAVY};padding:20px 24px">
      <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>
        <td style="vertical-align:middle;padding-right:14px">
          <img src="${LOGO_URL}" width="48" height="48" alt="SaamBiz" style="display:block;width:48px;height:48px;border:0;border-radius:12px" />
        </td>
        <td style="vertical-align:middle">
          <div style="color:#FFFFFF;font-size:20px;font-weight:bold;${POLICE}">Saam<span style="color:${OR}">Biz</span></div>
          <div style="width:36px;height:4px;background:${OR};border-radius:2px;margin-top:8px"></div>
        </td>
      </tr></table>
    </div>`;

/** Email complet autour d'un contenu HTML déjà échappé. */
const miseEnPage = (contenu, { titre = 'SaamBiz', apercu = '' } = {}) => `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${echapper(titre)}</title>
</head>
<body style="margin:0;padding:0;background:#F5F7FB">
${apercu ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${echapper(apercu)}</div>` : ''}
<div style="background:#F5F7FB;padding:24px 12px;${POLICE};color:#1C1C1E">
  <div style="max-width:520px;margin:0 auto;background:#FFFFFF;border-radius:16px;overflow:hidden">
${entete()}
    <div style="padding:24px;font-size:14px;line-height:1.6">
      ${contenu}
    </div>
  </div>
  <p style="text-align:center;font-size:11px;color:#9AA3B2;margin-top:14px">© ${new Date().getFullYear()} SaamBiz — Email envoyé automatiquement, merci de ne pas y répondre.</p>
</div>
</body>
</html>`;

/** « Bonjour Awa, » */
const salutation = (nom) =>
  `<p style="font-size:16px;margin:0 0 12px">Bonjour${nom ? ` ${echapper(nom)}` : ''},</p>`;

/** Paragraphe courant. */
const paragraphe = (html, style = '') => `<p style="margin:0 0 14px;${style}">${html}</p>`;

/** Mention discrète (expiration, sécurité…). */
const note = (html) => `<p style="font-size:13px;color:#616161;line-height:1.6;margin:0 0 8px">${html}</p>`;

/** Code à saisir : un chiffre par case, plus lisible et recopiable. */
const blocCode = (code) => {
  const cases = String(code)
    .split('')
    .map(
      (c) =>
        `<td style="width:44px;height:54px;background:#E8EEF9;border-radius:10px;text-align:center;font-size:26px;font-weight:bold;color:${NAVY};${POLICE}">${echapper(c)}</td>`
    )
    .join('<td style="width:8px"></td>');
  return `<table role="presentation" style="border-collapse:separate;margin:8px auto 20px"><tr>${cases}</tr></table>`;
};

/** Encadré d'informations : lignes « libellé / valeur ». */
const encadre = (lignes, couleur = NAVY) => `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5FD;border-left:4px solid ${couleur};border-radius:10px;margin:0 0 18px">
        ${lignes
          .map(
            ([libelle, valeur]) =>
              `<tr><td style="padding:8px 14px;color:#48597A;font-size:13px">${libelle}</td><td style="padding:8px 14px;color:${NAVY};font-size:14px;font-weight:bold;text-align:right">${valeur}</td></tr>`
          )
          .join('')}
      </table>`;

/** Liste à puces. */
const liste = (elements) =>
  `<ul style="margin:0 0 14px;padding-left:20px;color:#48597A;line-height:1.9">${elements.map((e) => `<li>${e}</li>`).join('')}</ul>`;

module.exports = { LOGO_URL, NAVY, OR, echapper, entete, miseEnPage, salutation, paragraphe, note, blocCode, encadre, liste };
