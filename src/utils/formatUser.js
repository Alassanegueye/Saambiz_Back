const formatUser = (utilisateur) => {
  const userFormatted = {
    id: utilisateur.id,
    nom: utilisateur.nom,
    prenom: utilisateur.prenom,
    email: utilisateur.email,
    adresse: utilisateur.adresse,
    telephone: utilisateur.telephone,
    photoProfil: utilisateur.photoProfil,
    role: utilisateur.role,
    // L'application s'en sert pour savoir si elle doit proposer de vérifier
    // l'adresse : les comptes créés avant l'inscription en deux temps peuvent
    // encore être non vérifiés.
    verifie: utilisateur.verifie === true,
    // Actif ou suspendu, et depuis quand le compte existe. Sans ces deux
    // champs, le back-office ne pouvait QUE se tromper : il en déduisait
    // « suspendu » pour tous les vendeurs — badge rouge, bouton « Réactiver »
    // au lieu de « Suspendre », filtre « Actifs » toujours vide — et
    // n'affichait qu'un tiret dans la colonne « Inscription ». Le défaut du
    // modèle est « actif » : une valeur absente ici ne doit pas se lire comme
    // une suspension.
    statut: utilisateur.statut || 'actif',
    createdAt: utilisateur.createdAt ?? null,
    // Compte supprimé par son titulaire : ni actif ni suspendu, et pas
    // réactivable — la connexion lui est refusée quoi qu'il arrive. Sans ce
    // champ, le back-office l'affichait comme une suspension ordinaire et
    // proposait un « Réactiver » sans effet.
    compteSupprime: utilisateur.compteSupprime === true,
    dateSuppression: utilisateur.dateSuppression ?? null,
  };

  if (utilisateur.role === 'Vendeur' && utilisateur.boutiques) {
    userFormatted.boutiques = utilisateur.boutiques;
  }

  return userFormatted;
};

module.exports = formatUser;
