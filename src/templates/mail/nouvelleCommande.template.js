// Nouvelle commande reçue par le vendeur.
const { miseEnPage, salutation, paragraphe, encadre, echapper } = require('./miseEnPage');

module.exports = function nouvelleCommandeTemplate({ nom, referenceCommande, montantTotal }) {
  return miseEnPage(
    `${salutation(nom)}
      ${paragraphe('Une nouvelle commande vient d\'arriver dans votre boutique. Ouvrez l\'application pour la traiter.')}
      ${encadre([
        ['Référence', echapper(referenceCommande)],
        ['Montant total', `${echapper(montantTotal)} FCFA`],
      ])}`,
    { titre: 'Nouvelle commande — SaamBiz', apercu: `Commande ${referenceCommande}` }
  );
};
