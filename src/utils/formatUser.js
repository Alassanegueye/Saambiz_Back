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
  };

  if (utilisateur.role === 'Vendeur' && utilisateur.boutiques) {
    userFormatted.boutiques = utilisateur.boutiques;
  }

  return userFormatted;
};

module.exports = formatUser;