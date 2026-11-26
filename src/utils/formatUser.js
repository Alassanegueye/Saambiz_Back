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

  // Première connexion (changement de mot de passe provisoire obligatoire sur
  // le portail Kodafrik) et accès à Kodafrik : exposés aux administrateurs.
  if (['Admin', 'SuperAdmin'].includes(utilisateur.role)) {
    userFormatted.isFirstLogin = utilisateur.isFirstLogin === true;
    userFormatted.accesKodafrik = utilisateur.role === 'SuperAdmin' || utilisateur.accesKodafrik === true;
  }

  // LE PIÈGE DE CETTE FONCTION : c'est une liste blanche. Tout champ qu'elle
  // ne nomme pas est SILENCIEUSEMENT PERDU.
  //
  // `ouvrirSession` allait chercher la boutique du vendeur et la joignait à
  // la session — avec un commentaire expliquant pourquoi l'écran de choix de
  // compte en a besoin. Le contrôleur passait ensuite la réponse par ici, qui
  // la jetait : elle n'était pas dans la liste. Le travail était fait des deux
  // côtés, et rien n'arrivait sur le téléphone.
  //
  // On reprend donc la boutique où qu'elle soit : déjà posée par
  // `ouvrirSession`, ou à tirer de la liste `boutiques` quand la requête l'a
  // chargée.
  if (utilisateur.role === 'Vendeur' && utilisateur.boutique) {
    const b = utilisateur.boutique;
    userFormatted.boutique = {
      id: b.id ?? null,
      nom: b.nom,
      slug: b.slug ?? null,
      logo: b.logo ?? null,
    };
  }

  if (utilisateur.role === 'Vendeur' && utilisateur.boutiques) {
    userFormatted.boutiques = utilisateur.boutiques;

    // `boutique` au singulier, en plus de la liste : c'est ce que
    // l'application mobile lit pour afficher la boutique sous le nom du
    // vendeur, sur son écran de choix de compte. Son lecteur existait déjà
    // et tolère les deux formes (objet ou chaîne) — le champ n'était
    // simplement jamais envoyé, et la ligne restait sans boutique.
    //
    // Ajouté plutôt que substitué à `boutiques` : une application déjà
    // installée lit peut-être la liste, et la lui retirer la casserait.
    const premiere = Array.isArray(utilisateur.boutiques)
      ? utilisateur.boutiques[0]
      : utilisateur.boutiques;
    const nom = premiere?.nom || premiere?.dataValues?.nom;
    if (nom && !userFormatted.boutique) {
      userFormatted.boutique = {
        id: premiere.id ?? null,
        nom,
        slug: premiere.slug ?? null,
        logo: premiere.logo ?? null,
      };
    }
  }

  return userFormatted;
};

module.exports = formatUser;
