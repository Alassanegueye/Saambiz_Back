module.exports = function newAdminTemplate({ nom, prenom, email, password }) {
  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f5f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f3;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#40916c;padding:32px 40px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Jëndal</h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;text-transform:uppercase;letter-spacing:0.1em;">Administration</p>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 40px;">
            <p style="margin:0 0 16px;color:#111;font-size:16px;">Bonjour <strong>${prenom} ${nom}</strong>,</p>
            <p style="margin:0 0 24px;color:#444;font-size:15px;line-height:1.6;">
              Nous venons de vous ajouter en tant qu'administrateur dans <strong>Jëndal</strong>.
            </p>
            <div style="background:#f5f5f3;border-radius:8px;padding:24px;margin:0 0 24px;">
              <p style="margin:0 0 12px;color:#666;font-size:13px;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Vos identifiants de connexion</p>
              <p style="margin:0 0 8px;color:#111;font-size:15px;"><strong>Identifiant :</strong> ${email}</p>
              <p style="margin:0;color:#111;font-size:15px;"><strong>Mot de passe :</strong> <code style="background:#e8e8e4;padding:2px 8px;border-radius:4px;font-family:monospace;font-size:14px;">${password}</code></p>
            </div>
            <div style="background:#fff8e1;border-left:4px solid #b8860b;border-radius:4px;padding:14px 16px;margin:0 0 24px;">
              <p style="margin:0;color:#7a5a00;font-size:13px;line-height:1.5;">
                &#9888;&#65039; <strong>Important :</strong> Lors de votre première connexion, vous serez invité(e) à changer votre mot de passe.
              </p>
            </div>
            <p style="margin:0;color:#666;font-size:13px;line-height:1.6;">
              Pour des raisons de sécurité, ne partagez jamais vos identifiants. Si vous n'êtes pas à l'origine de cette demande, contactez immédiatement votre super administrateur.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f5f5f3;padding:20px 40px;text-align:center;border-top:1px solid #e2e2de;">
            <p style="margin:0;color:#909088;font-size:12px;">© ${new Date().getFullYear()} Jëndal — Email généré automatiquement</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
};
