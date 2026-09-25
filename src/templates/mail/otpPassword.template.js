module.exports = function otpPasswordTemplate({ nom, otp }) {
  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Réinitialisation de mot de passe</title>
</head>
<body style="margin:0;padding:0;background-color:#fef9f0;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#fef9f0;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#f97316,#ea580c);padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:800;letter-spacing:-0.5px;">Jëndal</h1>
              <p style="margin:8px 0 0;color:rgba(255,255,255,0.9);font-size:14px;">Réinitialisation de votre mot de passe</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 16px;color:#374151;font-size:16px;">Bonjour <strong>${nom}</strong>,</p>
              <p style="margin:0 0 24px;color:#6b7280;font-size:15px;line-height:1.6;">
                Vous avez demandé la réinitialisation de votre mot de passe. Utilisez le code ci-dessous.
                Ce code est valable pendant <strong>1 heure</strong>.
              </p>
              <div style="background:#fff7ed;border:2px dashed #f97316;border-radius:12px;padding:24px;text-align:center;margin:0 0 24px;">
                <p style="margin:0 0 8px;color:#9a3412;font-size:12px;text-transform:uppercase;letter-spacing:2px;font-weight:700;">Votre code OTP</p>
                <span style="font-size:40px;font-weight:800;color:#ea580c;letter-spacing:10px;font-family:'Courier New',monospace;">${otp}</span>
              </div>
              <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.6;">
                Si vous n'avez pas fait cette demande, ignorez cet email. Votre mot de passe reste inchangé.
              </p>
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
              <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
                © ${new Date().getFullYear()} Jëndal — Ne répondez pas à cet email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
};
