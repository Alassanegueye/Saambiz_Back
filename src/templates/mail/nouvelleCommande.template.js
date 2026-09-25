module.exports = function nouvelleCommandeTemplate({ nom, referenceCommande, montantTotal }) {
  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Nouvelle commande — Jëndal</title>
</head>
<body style="margin:0;padding:0;background-color:#fef9f0;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#fef9f0;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#f97316,#ea580c);padding:36px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:800;">Jëndal</h1>
              <p style="margin:10px 0 0;color:rgba(255,255,255,0.9);font-size:15px;">Vous avez reçu une nouvelle commande !</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 16px;color:#374151;font-size:17px;font-weight:600;">Bonjour ${nom} 🛒</p>
              <p style="margin:0 0 24px;color:#6b7280;font-size:15px;line-height:1.7;">
                Une nouvelle commande vient d'être passée dans votre boutique. Connectez-vous à votre espace vendeur pour la traiter dès que possible.
              </p>
              <div style="background:#fff7ed;border-radius:10px;padding:20px;margin:0 0 24px;">
                <p style="margin:0 0 8px;color:#9a3412;font-size:14px;font-weight:600;">📦 Référence : ${referenceCommande}</p>
                <p style="margin:0;color:#9a3412;font-size:14px;font-weight:600;">💰 Montant total : ${montantTotal} FCFA</p>
              </div>
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
              <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
                © ${new Date().getFullYear()} Jëndal — La marketplace mobile du Sénégal.
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
