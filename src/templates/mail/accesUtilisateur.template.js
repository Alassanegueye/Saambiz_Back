// Compte client ou vendeur créé par un administrateur depuis le dashboard.
const { miseEnPage, salutation, paragraphe, note, encadre, echapper } = require('./miseEnPage');

module.exports = function accesUtilisateurTemplate({ prenom, nom, email, password, role }) {
  const vendeur = role === 'Vendeur';
  return miseEnPage(
    `${salutation([prenom, nom].filter(Boolean).join(' '))}
      ${paragraphe(vendeur
        ? 'Un compte <strong>vendeur SaamBiz</strong> vient d’être créé pour vous. Vos identifiants :'
        : 'Un compte <strong>SaamBiz</strong> vient d’être créé pour vous. Vos identifiants :')}
      ${encadre([
        ['Identifiant', echapper(email)],
        ['Mot de passe', `<code style="font-family:monospace">${echapper(password)}</code>`],
      ])}
      ${paragraphe(vendeur
        ? 'Connectez-vous dans l’application SaamBiz ou sur app.saambiz.com, puis changez ce mot de passe depuis votre profil.'
        : 'Connectez-vous dans l’application SaamBiz, puis changez ce mot de passe depuis votre profil.')}
      ${note('Vous n’attendiez pas cet email ? Ignorez-le ou contactez le support SaamBiz.')}`,
    { titre: 'Vos accès SaamBiz' }
  );
};
