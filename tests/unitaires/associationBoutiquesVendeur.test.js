/**
 * L'alias « boutiques » sur lequel s'appuient les commandes existe bien.
 *
 * Une faute dans un `as` ne se voit qu'à la première requête réelle : en
 * production, la liste des commandes échouerait entière. Charger les modèles
 * ne demande pas de base (Sequelize ne se connecte qu'à la première
 * requête) : on vérifie donc l'association elle-même.
 */
const { Utilisateur, Boutique } = require('../../src/models');

it('« boutiques » mène aux boutiques du vendeur', () => {
  const lien = Utilisateur.associations.boutiques;
  expect(lien).toBeDefined();
  expect(lien.target).toBe(Boutique);
  expect(lien.foreignKey).toBe('vendeurId');
});
