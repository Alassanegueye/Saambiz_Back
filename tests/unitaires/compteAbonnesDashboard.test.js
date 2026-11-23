/**
 * LE NOMBRE D'ABONNÉS, LE MÊME DES DEUX CÔTÉS.
 *
 * Un vendeur lisait « 1 client abonné à votre boutique » sur son accueil et
 * « Personne ne suit encore votre boutique » sur sa page Abonnés. Deux
 * nombres pour la même chose, sur le même compte, trouvés en parcourant
 * l'espace vendeur en production le 23 novembre 2026.
 *
 * La cause : les deux routes ne comptaient pas pareil. `dashboard()` faisait
 * un `Favori.count()` sur les lignes d'abonnement ; `abonnes()` chargeait ces
 * lignes avec leur acheteur puis écartait celles dont l'acheteur a disparu.
 * `Utilisateur` étant en suppression douce, un client qui supprime son compte
 * laisse une ligne orpheline : comptée ici, invisible là.
 *
 * Ces vérifications lisent le source du service plutôt que de l'exécuter.
 * C'est un choix, et il a une raison : `dashboard()` appelle une douzaine de
 * modèles et trois services, et le monter entièrement pour observer un seul
 * argument donnerait un test long dont l'échec ne désignerait plus la cause.
 * Ce qui compte ici est que la JOINTURE existe — sans elle le compte est
 * juste tant qu'aucun client n'a supprimé son compte, et faux le jour où
 * l'un le fait.
 */

const fs = require('fs');

const SOURCE = fs.readFileSync(
  require.resolve('../../src/services/vendeurs/vendeur.service.js'),
  'utf8',
);

/** L'appel `Favori.count(...)` et ses options, quel que soit son découpage. */
function appelFavoriCount() {
  const debut = SOURCE.indexOf('Favori.count(');
  if (debut === -1) return null;
  return SOURCE.slice(debut, debut + 400);
}

describe('le compte d’abonnés du tableau de bord', () => {
  it('compte les abonnements en joignant leur acheteur', () => {
    const appel = appelFavoriCount();
    expect(appel).toBeTruthy();
    expect(appel).toMatch(/include/);
    expect(appel).toMatch(/as: 'acheteur'/);
  });

  it('rend cette jointure obligatoire, sans quoi elle n’écarte rien', () => {
    // `required: true` fait la jointure interne. Sans lui, Sequelize garde la
    // ligne orpheline et le compte redevient celui d'avant.
    expect(appelFavoriCount()).toMatch(/required: true/);
  });

  it('écarte les mêmes lignes que la liste des abonnés', () => {
    // `abonnes()` filtre sur la présence de l'acheteur : les deux routes
    // doivent écarter exactement la même chose.
    expect(SOURCE).toMatch(/favoris\.filter\(\(f\) => f\.acheteur\)/);
  });
});
