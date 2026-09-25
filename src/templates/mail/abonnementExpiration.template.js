module.exports = function abonnementExpirationTemplate({ nom, dateFin, joursRestants }) {
  const formatDate = (d) => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  const isUrgent = joursRestants <= 3;

  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Abonnement bientôt expiré</title>
</head>
<body style="margin:0;padding:0;background-color:#fef9f0;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;background:#fef9f0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:${isUrgent ? 'linear-gradient(135deg,#dc2626,#b91c1c)' : 'linear-gradient(135deg,#f59e0b,#d97706)'};padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:800;">Jëndal</h1>
              <p style="margin:8px 0 0;color:rgba(255,255,255,0.9);font-size:14px;">
                ${isUrgent ? '🚨 Votre abonnement expire très bientôt !' : '⏰ Rappel : abonnement bientôt expiré'}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 16px;color:#374151;font-size:16px;">Bonjour <strong>${nom}</strong>,</p>
              <p style="margin:0 0 24px;color:#6b7280;font-size:15px;line-height:1.6;">
                Votre abonnement Jëndal expire dans <strong style="color:${isUrgent ? '#dc2626' : '#d97706'};">${joursRestants} jour${joursRestants > 1 ? 's' : ''}</strong>
                (le <strong>${formatDate(dateFin)}</strong>).<br/>
                Après cette date, vos produits ne seront plus visibles par les acheteurs.
              </p>
              <div style="background:${isUrgent ? '#fef2f2' : '#fffbeb'};border-radius:10px;padding:20px;margin:0 0 24px;border-left:4px solid ${isUrgent ? '#dc2626' : '#f59e0b'};">
                <p style="margin:0;color:#374151;font-size:14px;font-weight:600;">
                  Renouvelez maintenant depuis l'application pour continuer à vendre sans interruption.
                </p>
              </div>
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
              <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
                © ${new Date().getFullYear()} Jëndal — Cet email a été envoyé automatiquement.
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
