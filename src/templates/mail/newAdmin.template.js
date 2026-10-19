// Accès d'un nouvel administrateur créé par le super administrateur.
const { miseEnPage, salutation, paragraphe, note, encadre, echapper } = require('./miseEnPage');

module.exports = function newAdminTemplate({ nom, prenom, email, password }) {
  return miseEnPage(
    `${salutation([prenom, nom].filter(Boolean).join(' '))}
      ${paragraphe('Vous avez été ajouté(e) comme administrateur de <strong>SaamBiz</strong>. Vos identifiants :')}
      ${encadre([
        ['Identifiant', echapper(email)],
        ['Mot de passe', `<code style="font-family:monospace">${echapper(password)}</code>`],
      ])}
      ${paragraphe('<strong>Important :</strong> vous devrez changer ce mot de passe à la première connexion.')}
      ${note('Ne partagez jamais vos identifiants. Si vous n\'attendiez pas cet email, prévenez votre super administrateur.')}`,
    { titre: 'Vos accès administrateur — SaamBiz' }
  );
};
