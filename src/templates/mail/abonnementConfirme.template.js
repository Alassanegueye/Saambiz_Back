module.exports = function abonnementConfirmeTemplate({ nom, montant, dateDebut, dateFin }) {
  const formatDate = (d) => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Abonnement confirmé</title>
</head>
<body style="margin:0;padding:0;background-color:#fef9f0;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;background:#fef9f0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#16a34a,#15803d);padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:800;">Jëndal</h1>
              <p style="margin:8px 0 0;color:rgba(255,255,255,0.9);font-size:14px;">✅ Abonnement activé avec succès</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 16px;color:#374151;font-size:16px;">Bonjour <strong>${nom}</strong>,</p>
              <p style="margin:0 0 24px;color:#6b7280;font-size:15px;line-height:1.6;">
                Votre paiement a bien été reçu et votre abonnement est maintenant actif. Vos produits sont visibles par tous les acheteurs.
              </p>
              <table width="100%" style="background:#f0fdf4;border-radius:10px;padding:20px;margin:0 0 24px;border-left:4px solid #16a34a;">
                <tr>
                  <td style="padding:6px 0;color:#374151;font-size:14px;"><strong>Montant payé :</strong></td>
                  <td style="padding:6px 0;color:#16a34a;font-size:14px;font-weight:700;text-align:right;">${montant} FCFA</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;color:#374151;font-size:14px;"><strong>Début :</strong></td>
                  <td style="padding:6px 0;color:#374151;font-size:14px;text-align:right;">${formatDate(dateDebut)}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;color:#374151;font-size:14px;"><strong>Expiration :</strong></td>
                  <td style="padding:6px 0;color:#374151;font-size:14px;text-align:right;">${formatDate(dateFin)}</td>
                </tr>
              </table>
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
              <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
                © ${new Date().getFullYear()} Jëndal — Merci de votre confiance.
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
