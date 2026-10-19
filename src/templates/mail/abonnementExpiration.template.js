// Rappel avant l'expiration de l'abonnement (tâche planifiée).
const { miseEnPage, salutation, paragraphe, encadre } = require('./miseEnPage');

const formatDate = (d) => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

module.exports = function abonnementExpirationTemplate({ nom, dateFin, joursRestants }) {
  const urgent = joursRestants <= 3;
  const jours = `${joursRestants} jour${joursRestants > 1 ? 's' : ''}`;
  return miseEnPage(
    `${salutation(nom)}
      ${paragraphe(`Votre abonnement SaamBiz expire dans <strong style="color:${urgent ? '#C62828' : '#8A6503'}">${jours}</strong>. Ensuite, vos produits ne seront plus visibles.`)}
      ${encadre([['Date de fin', formatDate(dateFin)]], urgent ? '#C62828' : '#F2B705')}
      ${paragraphe('Renouvelez-le depuis l\'application pour continuer à vendre sans interruption.')}`,
    { titre: 'Votre abonnement expire bientôt', apercu: `Expiration dans ${jours}` }
  );
};
