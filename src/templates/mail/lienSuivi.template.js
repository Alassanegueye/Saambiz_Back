// « J'ai perdu mon lien » : le client redemande l'accès à ses commandes.
//
// Cet email ne confirme rien et n'annonce rien : il rend une porte. Il part
// uniquement si des commandes existent à cette adresse — autrement, rien
// n'est envoyé, et la réponse de l'API reste la même pour que la route ne
// dise pas qui a commandé où.
const { miseEnPage, salutation, paragraphe, note, echapper, bouton } = require('./miseEnPage');

/** « 9 décembre 2026 » : une date qu'on lit, pas un horodatage. */
const jourLisible = (date) => new Date(date).toLocaleDateString('fr-FR', {
  day: 'numeric', month: 'long', year: 'numeric',
});

function lienSuiviTemplate({ lien, expireLe, jours = 15, nomClient = '' }) {
  const html = miseEnPage(
    `${salutation(nomClient)}
      ${paragraphe('Voici votre lien pour suivre vos commandes. Il vous est personnel : ne le transmettez pas.')}
      ${bouton('Voir mes commandes', lien)}
      ${note(`Si le bouton ne fonctionne pas, copiez cette adresse dans votre navigateur :<br><span style="word-break:break-all;color:#48597A">${echapper(lien)}</span>`)}
      ${note(`Ce lien reste valable ${jours} jours${expireLe ? `, jusqu'au ${jourLisible(expireLe)}` : ''}. Ensuite, redemandez-en un avec votre adresse email.`)}
      ${note("Vous n'avez rien demandé ? Ignorez cet email : le lien ne s'ouvrira que depuis ce message.")}`,
    { titre: 'Votre lien de suivi', apercu: 'Suivez vos commandes' }
  );
  return { objet: 'Votre lien de suivi SaamBiz', html };
}

module.exports = lienSuiviTemplate;
