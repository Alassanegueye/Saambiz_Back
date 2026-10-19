// Bienvenue après l'inscription (client ou vendeur).
const { miseEnPage, salutation, paragraphe, liste } = require('./miseEnPage');

module.exports = function welcomeTemplate({ nom, prenom, role }) {
  const isVendeur = role === 'Vendeur';
  const qui = [prenom, nom].filter(Boolean).join(' ');
  const contenu = isVendeur
    ? `${paragraphe('Bienvenue sur <strong>SaamBiz</strong> ! Votre espace vendeur est prêt : votre <strong>mois d\'essai gratuit</strong> a démarré.')}
      ${liste(['Complétez votre boutique', 'Ajoutez vos premiers produits', 'Partagez le lien de votre boutique'])}`
    : `${paragraphe('Bienvenue sur <strong>SaamBiz</strong> ! Votre compte est prêt.')}
      ${liste(['Découvrez les boutiques près de chez vous', 'Suivez vos boutiques préférées', 'Commandez et suivez vos livraisons'])}`;
  return miseEnPage(`${salutation(qui)}${contenu}`, { titre: 'Bienvenue sur SaamBiz' });
};
