/**
 * Contrat des routes d'administration.
 *
 * Ce fichier est ENGENDRÉ par `scripts/generer_contrat_admin.py` depuis
 * l'inventaire des routes Express. À régénérer avec
 * `bash scripts/regenerer-contrat-routes.sh` après tout ajout de route.
 *
 * Il vérifie deux choses, pour les 84 routes du back-office :
 *
 *  1. la route est montée — un chemin mal orthographié dans `app.js` ou un
 *     routeur monté après celui qui le capte produit un 404 que seule
 *     l'administration découvre, en production ;
 *  2. elle refuse une requête sans jeton. Une route d'administration ne doit
 *     jamais tenir sa sécurité du seul fait qu'aucun menu n'y conduit : la
 *     chaîne est `auth` → `checkActiveUser` → `isAdmin` → `requirePermission`,
 *     et c'est le premier maillon qui est vérifié ici.
 *
 * Ce test ne touche pas la base : `auth` refuse avant d'y arriver.
 *
 * Les deux adresses sont couvertes : `/saambiz/v1` et l'alias historique
 * `/saambiz`.
 */

const request = require('supertest');
const app = require('../../src/app');

const ROUTES = [
  { methode: 'POST', chemin: '/admin/abonnement-manuel/:vendeurId', url: '/admin/abonnement-manuel/3f6c1c2e-0000-4000-8000-000000000000' },
  { methode: 'PUT', chemin: '/admin/abonnement/:id/revoquer', url: '/admin/abonnement/3f6c1c2e-0000-4000-8000-000000000000/revoquer' },
  { methode: 'GET', chemin: '/admin/abonnements', url: '/admin/abonnements' },
  { methode: 'GET', chemin: '/admin/abonnements-expiration', url: '/admin/abonnements-expiration' },
  { methode: 'DELETE', chemin: '/admin/acheteur/:id', url: '/admin/acheteur/3f6c1c2e-0000-4000-8000-000000000000' },
  { methode: 'PUT', chemin: '/admin/acheteur/:id', url: '/admin/acheteur/3f6c1c2e-0000-4000-8000-000000000000' },
  { methode: 'PUT', chemin: '/admin/acheteur/:id/activer', url: '/admin/acheteur/3f6c1c2e-0000-4000-8000-000000000000/activer' },
  { methode: 'PUT', chemin: '/admin/acheteur/:id/suspendre', url: '/admin/acheteur/3f6c1c2e-0000-4000-8000-000000000000/suspendre' },
  { methode: 'POST', chemin: '/admin/acheteurs', url: '/admin/acheteurs' },
  { methode: 'POST', chemin: '/admin/ajout-categorie', url: '/admin/ajout-categorie' },
  { methode: 'GET', chemin: '/admin/audit-logs', url: '/admin/audit-logs' },
  { methode: 'GET', chemin: '/admin/audit-logs/resume', url: '/admin/audit-logs/resume' },
  { methode: 'DELETE', chemin: '/admin/boutique/:id', url: '/admin/boutique/3f6c1c2e-0000-4000-8000-000000000000' },
  { methode: 'DELETE', chemin: '/admin/boutique/:id/site', url: '/admin/boutique/3f6c1c2e-0000-4000-8000-000000000000/site' },
  { methode: 'PUT', chemin: '/admin/boutique/:id/site', url: '/admin/boutique/3f6c1c2e-0000-4000-8000-000000000000/site' },
  { methode: 'GET', chemin: '/admin/boutiques-options', url: '/admin/boutiques-options' },
  { methode: 'DELETE', chemin: '/admin/categorie/:id', url: '/admin/categorie/3f6c1c2e-0000-4000-8000-000000000000' },
  { methode: 'PUT', chemin: '/admin/categorie/:id', url: '/admin/categorie/3f6c1c2e-0000-4000-8000-000000000000' },
  { methode: 'GET', chemin: '/admin/categories', url: '/admin/categories' },
  { methode: 'PUT', chemin: '/admin/categories/ordre', url: '/admin/categories/ordre' },
  { methode: 'GET', chemin: '/admin/centre-aide', url: '/admin/centre-aide' },
  { methode: 'PUT', chemin: '/admin/centre-aide/contacts', url: '/admin/centre-aide/contacts' },
  { methode: 'POST', chemin: '/admin/centre-aide/questions', url: '/admin/centre-aide/questions' },
  { methode: 'DELETE', chemin: '/admin/centre-aide/questions/:id', url: '/admin/centre-aide/questions/3f6c1c2e-0000-4000-8000-000000000000' },
  { methode: 'PUT', chemin: '/admin/centre-aide/questions/:id', url: '/admin/centre-aide/questions/3f6c1c2e-0000-4000-8000-000000000000' },
  { methode: 'PUT', chemin: '/admin/centre-aide/questions/ordre', url: '/admin/centre-aide/questions/ordre' },
  { methode: 'DELETE', chemin: '/admin/commande/:id', url: '/admin/commande/3f6c1c2e-0000-4000-8000-000000000000' },
  { methode: 'GET', chemin: '/admin/commande/:id', url: '/admin/commande/3f6c1c2e-0000-4000-8000-000000000000' },
  { methode: 'PUT', chemin: '/admin/commande/:id', url: '/admin/commande/3f6c1c2e-0000-4000-8000-000000000000' },
  { methode: 'GET', chemin: '/admin/commandes', url: '/admin/commandes' },
  { methode: 'POST', chemin: '/admin/commandes', url: '/admin/commandes' },
  { methode: 'GET', chemin: '/admin/configs', url: '/admin/configs' },
  { methode: 'POST', chemin: '/admin/configs', url: '/admin/configs' },
  { methode: 'PUT', chemin: '/admin/configs/:cle', url: '/admin/configs/prix_abonnement' },
  { methode: 'GET', chemin: '/admin/configs/prix-abonnement', url: '/admin/configs/prix-abonnement' },
  { methode: 'GET', chemin: '/admin/demandes-retour', url: '/admin/demandes-retour' },
  { methode: 'PUT', chemin: '/admin/demandes-retour/:id/traiter', url: '/admin/demandes-retour/3f6c1c2e-0000-4000-8000-000000000000/traiter' },
  { methode: 'GET', chemin: '/admin/inscriptions-mensuelles', url: '/admin/inscriptions-mensuelles' },
  { methode: 'GET', chemin: '/admin/liste-clients', url: '/admin/liste-clients' },
  { methode: 'GET', chemin: '/admin/liste-produits-actifs', url: '/admin/liste-produits-actifs' },
  { methode: 'GET', chemin: '/admin/liste-vendeurs', url: '/admin/liste-vendeurs' },
  { methode: 'GET', chemin: '/admin/nombre-clients-actifs', url: '/admin/nombre-clients-actifs' },
  { methode: 'GET', chemin: '/admin/nombre-clients-inactifs', url: '/admin/nombre-clients-inactifs' },
  { methode: 'GET', chemin: '/admin/nombre-produits-actifs', url: '/admin/nombre-produits-actifs' },
  { methode: 'GET', chemin: '/admin/nombre-vendeurs-actif', url: '/admin/nombre-vendeurs-actif' },
  { methode: 'GET', chemin: '/admin/nombre-vendeurs-inactif', url: '/admin/nombre-vendeurs-inactif' },
  { methode: 'POST', chemin: '/admin/notification-globale', url: '/admin/notification-globale' },
  { methode: 'GET', chemin: '/admin/paiements', url: '/admin/paiements' },
  { methode: 'GET', chemin: '/admin/paiements/echecs', url: '/admin/paiements/echecs' },
  { methode: 'PUT', chemin: '/admin/prix-abonnement', url: '/admin/prix-abonnement' },
  { methode: 'DELETE', chemin: '/admin/produit/:id', url: '/admin/produit/3f6c1c2e-0000-4000-8000-000000000000' },
  { methode: 'GET', chemin: '/admin/produit/:id', url: '/admin/produit/3f6c1c2e-0000-4000-8000-000000000000' },
  { methode: 'PUT', chemin: '/admin/produit/:id', url: '/admin/produit/3f6c1c2e-0000-4000-8000-000000000000' },
  { methode: 'PUT', chemin: '/admin/produit/:id/approuver', url: '/admin/produit/3f6c1c2e-0000-4000-8000-000000000000/approuver' },
  { methode: 'PUT', chemin: '/admin/produit/:id/rejeter', url: '/admin/produit/3f6c1c2e-0000-4000-8000-000000000000/rejeter' },
  { methode: 'GET', chemin: '/admin/produits', url: '/admin/produits' },
  { methode: 'POST', chemin: '/admin/produits', url: '/admin/produits' },
  { methode: 'GET', chemin: '/admin/produits-en-attente', url: '/admin/produits-en-attente' },
  { methode: 'GET', chemin: '/admin/rbac/admins', url: '/admin/rbac/admins' },
  { methode: 'POST', chemin: '/admin/rbac/admins', url: '/admin/rbac/admins' },
  { methode: 'DELETE', chemin: '/admin/rbac/admins/:userId', url: '/admin/rbac/admins/3f6c1c2e-0000-4000-8000-000000000000' },
  { methode: 'PUT', chemin: '/admin/rbac/admins/:userId', url: '/admin/rbac/admins/3f6c1c2e-0000-4000-8000-000000000000' },
  { methode: 'GET', chemin: '/admin/rbac/admins/:userId/permissions', url: '/admin/rbac/admins/3f6c1c2e-0000-4000-8000-000000000000/permissions' },
  { methode: 'PUT', chemin: '/admin/rbac/admins/:userId/permissions', url: '/admin/rbac/admins/3f6c1c2e-0000-4000-8000-000000000000/permissions' },
  { methode: 'GET', chemin: '/admin/rbac/menus', url: '/admin/rbac/menus' },
  { methode: 'POST', chemin: '/admin/rbac/menus', url: '/admin/rbac/menus' },
  { methode: 'DELETE', chemin: '/admin/rbac/menus/:id', url: '/admin/rbac/menus/3f6c1c2e-0000-4000-8000-000000000000' },
  { methode: 'PUT', chemin: '/admin/rbac/menus/:id', url: '/admin/rbac/menus/3f6c1c2e-0000-4000-8000-000000000000' },
  { methode: 'GET', chemin: '/admin/revenus-mensuels', url: '/admin/revenus-mensuels' },
  { methode: 'PUT', chemin: '/admin/signalement/:id/rejeter', url: '/admin/signalement/3f6c1c2e-0000-4000-8000-000000000000/rejeter' },
  { methode: 'PUT', chemin: '/admin/signalement/:id/traiter', url: '/admin/signalement/3f6c1c2e-0000-4000-8000-000000000000/traiter' },
  { methode: 'GET', chemin: '/admin/signalements', url: '/admin/signalements' },
  { methode: 'GET', chemin: '/admin/stats-ecommerce', url: '/admin/stats-ecommerce' },
  { methode: 'GET', chemin: '/admin/stats-globales', url: '/admin/stats-globales' },
  { methode: 'DELETE', chemin: '/admin/supprimer-utilisateur/:id', url: '/admin/supprimer-utilisateur/3f6c1c2e-0000-4000-8000-000000000000' },
  { methode: 'DELETE', chemin: '/admin/vendeur/:id', url: '/admin/vendeur/3f6c1c2e-0000-4000-8000-000000000000' },
  { methode: 'PUT', chemin: '/admin/vendeur/:id', url: '/admin/vendeur/3f6c1c2e-0000-4000-8000-000000000000' },
  { methode: 'PUT', chemin: '/admin/vendeur/:id/activer', url: '/admin/vendeur/3f6c1c2e-0000-4000-8000-000000000000/activer' },
  { methode: 'PUT', chemin: '/admin/vendeur/:id/rejeter', url: '/admin/vendeur/3f6c1c2e-0000-4000-8000-000000000000/rejeter' },
  { methode: 'PUT', chemin: '/admin/vendeur/:id/suspendre', url: '/admin/vendeur/3f6c1c2e-0000-4000-8000-000000000000/suspendre' },
  { methode: 'PUT', chemin: '/admin/vendeur/:id/valider', url: '/admin/vendeur/3f6c1c2e-0000-4000-8000-000000000000/valider' },
  { methode: 'PUT', chemin: '/admin/vendeur/:id/verifier', url: '/admin/vendeur/3f6c1c2e-0000-4000-8000-000000000000/verifier' },
  { methode: 'POST', chemin: '/admin/vendeurs', url: '/admin/vendeurs' },
  { methode: 'GET', chemin: '/admin/vendeurs-a-valider', url: '/admin/vendeurs-a-valider' },
];

/** Envoie la requête sans jeton. */
function appeler(base, route) {
  return request(app)[route.methode.toLowerCase()](`${base}${route.url}`);
}

describe('Contrat des routes d\'administration', () => {
  it('l\'inventaire couvre bien toutes les routes attendues', () => {
    expect(ROUTES).toHaveLength(84);
  });

  describe.each(['/saambiz/v1', '/saambiz'])('adresse %s', (base) => {
    it.each(ROUTES.map((r) => [`${r.methode} ${r.chemin}`, r]))(
      '%s est montée',
      async (_nom, route) => {
        const res = await appeler(base, route);
        expect(res.status).not.toBe(404);
      },
    );
  });

  describe('aucune route d\'administration n\'est ouverte', () => {
    it.each(ROUTES.map((r) => [`${r.methode} ${r.chemin}`, r]))(
      '%s refuse une requête sans jeton',
      async (_nom, route) => {
        const res = await appeler('/saambiz/v1', route);
        expect(res.status).toBe(401);
      },
    );
  });
});
