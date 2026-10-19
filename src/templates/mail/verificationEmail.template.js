// Code à 6 chiffres envoyé avant la création du compte, pour confirmer
// l'adresse email.
const { miseEnPage, salutation, paragraphe, note, blocCode } = require('./miseEnPage');

module.exports = function verificationEmailTemplate({ nom, code, minutes = 15 }) {
  return miseEnPage(
    `${salutation(nom)}
      ${paragraphe('Pour confirmer votre adresse email, saisissez ce code dans l\'application SaamBiz :')}
      ${blocCode(code)}
      ${note(`Ce code expire dans <strong>${Number(minutes)} minutes</strong>. Vous pouvez en demander un nouveau depuis l'application.`)}
      ${note('Vous n\'êtes pas à l\'origine de cette inscription ? Ignorez simplement cet email.')}`,
    { titre: 'Votre code de vérification SaamBiz', apercu: `Votre code : ${code}` }
  );
};
