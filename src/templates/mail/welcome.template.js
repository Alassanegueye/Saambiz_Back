module.exports = function welcomeTemplate({ nom, prenom, role }) {
  const isVendeur = role === 'Vendeur';
  const subtitle = isVendeur
    ? 'Votre boutique vous attend !'
    : 'Découvrez les meilleures saveurs maison près de chez vous !';

  const bodyText = isVendeur
    ? `Vous êtes maintenant enregistré en tant que <strong>vendeur</strong> sur Jëndal.<br/>
       Votre période d'essai d'<strong>1 mois gratuit</strong> a démarré. Créez vos produits et commencez à vendre dès aujourd'hui.`
    : `Bienvenue parmi nos acheteurs ! Parcourez les boutiques près de chez vous et commandez vos produits préférés.`;

  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bienvenue sur Jëndal</title>
</head>
<body style="margin:0;padding:0;background-color:#fef9f0;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#fef9f0;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#f97316,#ea580c);padding:36px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:800;">Jëndal</h1>
              <p style="margin:10px 0 0;color:rgba(255,255,255,0.9);font-size:15px;">${subtitle}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 16px;color:#374151;font-size:17px;font-weight:600;">Bonjour ${prenom} ${nom} ! 🎉</p>
              <p style="margin:0 0 24px;color:#6b7280;font-size:15px;line-height:1.7;">${bodyText}</p>
              <div style="background:#fff7ed;border-radius:10px;padding:20px;margin:0 0 24px;">
                <p style="margin:0;color:#9a3412;font-size:14px;font-weight:600;">💡 Pour commencer :</p>
                <ul style="margin:10px 0 0;padding-left:20px;color:#6b7280;font-size:14px;line-height:2;">
                  ${isVendeur
                    ? '<li>Complétez votre profil boutique</li><li>Ajoutez vos premiers produits</li><li>Activez votre abonnement avant la fin de l\'essai</li>'
                    : '<li>Explorez les boutiques près de vous</li><li>Suivez vos boutiques préférées et activez la cloche 🔔</li><li>Contactez directement les vendeurs</li>'
                  }
                </ul>
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
