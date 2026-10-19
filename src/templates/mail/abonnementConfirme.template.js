// Paiement reçu : l'abonnement du vendeur est actif.
const { miseEnPage, salutation, paragraphe, encadre, echapper } = require('./miseEnPage');

const formatDate = (d) => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

module.exports = function abonnementConfirmeTemplate({ nom, montant, dateDebut, dateFin }) {
  return miseEnPage(
    `${salutation(nom)}
      ${paragraphe('Votre paiement a bien été reçu : votre abonnement SaamBiz est <strong>actif</strong>.')}
      ${encadre([
        ['Montant', `${echapper(montant)} FCFA`],
        ['Début', formatDate(dateDebut)],
        ['Fin', formatDate(dateFin)],
      ], '#22C55E')}
      ${paragraphe('Merci de votre confiance !')}`,
    { titre: 'Votre abonnement SaamBiz est actif' }
  );
};
