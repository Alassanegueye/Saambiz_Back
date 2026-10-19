// Code de réinitialisation du mot de passe.
const { miseEnPage, salutation, paragraphe, note, blocCode } = require('./miseEnPage');

module.exports = function otpPasswordTemplate({ nom, otp }) {
  return miseEnPage(
    `${salutation(nom)}
      ${paragraphe('Voici votre code de réinitialisation du mot de passe :')}
      ${blocCode(otp)}
      ${note('Ce code est valable <strong>1 heure</strong>.')}
      ${note('Vous n\'avez rien demandé ? Ignorez cet email : votre mot de passe reste inchangé.')}`,
    { titre: 'Réinitialisation du mot de passe — SaamBiz', apercu: `Votre code : ${otp}` }
  );
};
