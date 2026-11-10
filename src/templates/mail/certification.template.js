// Réponse à une demande de certification : boutique certifiée, ou demande
// refusée avec son motif.
const { miseEnPage, salutation, paragraphe, echapper } = require('./miseEnPage');

module.exports = function certificationTemplate({ prenom, boutique, approuvee, motif }) {
  const nomBoutique = boutique ? `<strong>${echapper(boutique)}</strong>` : 'votre boutique';

  if (approuvee) {
    return miseEnPage(
      `${salutation(prenom)}
        ${paragraphe(`Bonne nouvelle : votre pièce d'identité a été vérifiée et ${nomBoutique} est maintenant <strong>certifiée</strong> sur SaamBiz.`)}
        ${paragraphe('Le badge de certification s\'affiche désormais sur votre boutique et sur votre site. Vos clients savent qu\'ils achètent chez un vendeur dont l\'identité a été vérifiée.')}
        ${paragraphe('Merci de votre confiance, et bonnes ventes !')}`,
      { titre: 'Votre boutique est certifiée' }
    );
  }

  return miseEnPage(
    `${salutation(prenom)}
      ${paragraphe(`Nous avons examiné votre demande de certification pour ${nomBoutique}, mais nous n'avons pas pu l'accepter.`)}
      ${paragraphe(`<strong>Motif :</strong> ${echapper(motif || 'photos illisibles ou incomplètes')}`)}
      ${paragraphe('Vous pouvez renvoyer les photos (recto et verso) de votre pièce d\'identité depuis votre compte, dans l\'application SaamBiz.')}`,
    { titre: 'Votre demande de certification' }
  );
};
