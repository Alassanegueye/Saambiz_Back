// Niveau de fidélité d'un client envers une boutique, d'après ses commandes
// non annulées. Le seuil vit ici pour rester le même partout.
const SEUIL_CLIENT_FIDELE = 3;

function niveauFidelite(nombreCommandes) {
  return nombreCommandes >= SEUIL_CLIENT_FIDELE ? 'fidele' : 'nouveau';
}

module.exports = { niveauFidelite, SEUIL_CLIENT_FIDELE };
