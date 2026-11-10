/**
 * Contrat des routes destinées à l'application mobile.
 *
 * Ce fichier est ENGENDRÉ depuis l'inventaire des routes Express
 * (`scripts/generer_contrat.py`). Il répond à deux questions que
 * rien d'autre ne pose :
 *
 *  1. la route est-elle réellement montée ? Un chemin mal orthographié dans
 *     `app.js`, un routeur oublié, un `router.use` placé après une route qui
 *     le capte : tout cela produit un 404 que seule l'application découvre,
 *     en production, sous la forme d'un écran vide.
 *
 *  2. la route est-elle protégée quand elle doit l'être ? Un `authMiddleware`
 *     oublié ouvre une route de vendeur au premier venu. Le test interroge
 *     SANS jeton : une route protégée doit répondre 401, pas 200 ni 500.
 *
 * Les routes publiques ne sont vérifiées que sur le premier point : sans base
 * de données, leur contrôleur échoue — ce qui est sans importance ici, un 500
 * prouvant déjà que la route existe et qu'elle a été atteinte.
 *
 * Les deux adresses sont couvertes : `/saambiz/v1` (référence) et `/saambiz`
 * (alias historique, encore appelé par les applications installées).
 *
 * 126 routes, dont 103 protégées.
 */

const request = require('supertest');
const app = require('../../src/app');

const ROUTES = [
  { methode: 'PUT', chemin: '/account/change-password', url: '/account/change-password', protegee: true },
  { methode: 'POST', chemin: '/account/forgot-password', url: '/account/forgot-password', protegee: true },
  { methode: 'DELETE', chemin: '/account/me', url: '/account/me', protegee: true },
  { methode: 'GET', chemin: '/account/me', url: '/account/me', protegee: true },
  { methode: 'PUT', chemin: '/account/modifier-profil', url: '/account/modifier-profil', protegee: true },
  { methode: 'POST', chemin: '/account/reset-password', url: '/account/reset-password', protegee: true },
  { methode: 'GET', chemin: '/acheteurs/accueil', url: '/acheteurs/accueil', protegee: true },
  { methode: 'GET', chemin: '/acheteurs/accueil-personnalise', url: '/acheteurs/accueil-personnalise', protegee: false },
  { methode: 'GET', chemin: '/acheteurs/accueil-section/:cle', url: '/acheteurs/accueil-section/nouveautes', protegee: false },
  { methode: 'GET', chemin: '/acheteurs/boutique/:id', url: '/acheteurs/boutique/3f6c1c2e-0000-4000-8000-000000000000', protegee: true },
  { methode: 'GET', chemin: '/acheteurs/boutiques-proches', url: '/acheteurs/boutiques-proches', protegee: true },
  { methode: 'GET', chemin: '/acheteurs/boutiques-verifiees', url: '/acheteurs/boutiques-verifiees', protegee: true },
  { methode: 'GET', chemin: '/acheteurs/contacter-vendeur-par-whatsapp/:id', url: '/acheteurs/contacter-vendeur-par-whatsapp/3f6c1c2e-0000-4000-8000-000000000000', protegee: true },
  { methode: 'GET', chemin: '/acheteurs/decouverte', url: '/acheteurs/decouverte', protegee: true },
  { methode: 'GET', chemin: '/acheteurs/filtrer-produit-ville', url: '/acheteurs/filtrer-produit-ville', protegee: true },
  { methode: 'GET', chemin: '/acheteurs/liste-boutiques', url: '/acheteurs/liste-boutiques', protegee: true },
  { methode: 'GET', chemin: '/acheteurs/liste-produit-par-boutique/:boutiqueId', url: '/acheteurs/liste-produit-par-boutique/3f6c1c2e-0000-4000-8000-000000000000', protegee: true },
  { methode: 'GET', chemin: '/acheteurs/liste-produits', url: '/acheteurs/liste-produits', protegee: true },
  { methode: 'GET', chemin: '/acheteurs/mes-conversations', url: '/acheteurs/mes-conversations', protegee: true },
  { methode: 'GET', chemin: '/acheteurs/mon-tableau-de-bord', url: '/acheteurs/mon-tableau-de-bord', protegee: true },
  { methode: 'GET', chemin: '/acheteurs/nouvelles-boutiques', url: '/acheteurs/nouvelles-boutiques', protegee: true },
  { methode: 'GET', chemin: '/acheteurs/preferences', url: '/acheteurs/preferences', protegee: true },
  { methode: 'PUT', chemin: '/acheteurs/preferences', url: '/acheteurs/preferences', protegee: true },
  { methode: 'GET', chemin: '/acheteurs/produit/:id', url: '/acheteurs/produit/3f6c1c2e-0000-4000-8000-000000000000', protegee: true },
  { methode: 'POST', chemin: '/acheteurs/produit/:id/vue', url: '/acheteurs/produit/3f6c1c2e-0000-4000-8000-000000000000/vue', protegee: true },
  { methode: 'GET', chemin: '/acheteurs/produits', url: '/acheteurs/produits', protegee: true },
  { methode: 'GET', chemin: '/acheteurs/produits-tendance', url: '/acheteurs/produits-tendance', protegee: true },
  { methode: 'GET', chemin: '/acheteurs/promotions-actives', url: '/acheteurs/promotions-actives', protegee: true },
  { methode: 'GET', chemin: '/acheteurs/recherche', url: '/acheteurs/recherche', protegee: true },
  { methode: 'GET', chemin: '/acheteurs/rechercher-produit-categorie', url: '/acheteurs/rechercher-produit-categorie', protegee: true },
  { methode: 'GET', chemin: '/app/config', url: '/app/config', protegee: false },
  { methode: 'POST', chemin: '/auth/changer-mot-de-passe', url: '/auth/changer-mot-de-passe', protegee: true },
  { methode: 'POST', chemin: '/auth/inscription/envoyer-code', url: '/auth/inscription/envoyer-code', protegee: false },
  { methode: 'POST', chemin: '/auth/inscription/verifier-code', url: '/auth/inscription/verifier-code', protegee: false },
  { methode: 'POST', chemin: '/auth/login', url: '/auth/login', protegee: false },
  { methode: 'POST', chemin: '/auth/logout', url: '/auth/logout', protegee: true },
  { methode: 'POST', chemin: '/auth/refresh', url: '/auth/refresh', protegee: false },
  { methode: 'POST', chemin: '/auth/register', url: '/auth/register', protegee: false },
  { methode: 'POST', chemin: '/auth/resend-verification', url: '/auth/resend-verification', protegee: false },
  { methode: 'POST', chemin: '/auth/social', url: '/auth/social', protegee: false },
  { methode: 'GET', chemin: '/auth/verify-email', url: '/auth/verify-email', protegee: false },
  { methode: 'POST', chemin: '/auth/verify-email', url: '/auth/verify-email', protegee: false },
  { methode: 'POST', chemin: '/avis', url: '/avis', protegee: true },
  { methode: 'DELETE', chemin: '/avis/boutique/:boutiqueId', url: '/avis/boutique/3f6c1c2e-0000-4000-8000-000000000000', protegee: true },
  { methode: 'GET', chemin: '/avis/boutique/:boutiqueId', url: '/avis/boutique/3f6c1c2e-0000-4000-8000-000000000000', protegee: false },
  { methode: 'GET', chemin: '/avis/boutique/:boutiqueId/mon-avis', url: '/avis/boutique/3f6c1c2e-0000-4000-8000-000000000000/mon-avis', protegee: true },
  { methode: 'GET', chemin: '/catalogue/boutiques', url: '/catalogue/boutiques', protegee: false },
  { methode: 'GET', chemin: '/catalogue/boutiques/:id', url: '/catalogue/boutiques/3f6c1c2e-0000-4000-8000-000000000000', protegee: false },
  { methode: 'GET', chemin: '/catalogue/produits', url: '/catalogue/produits', protegee: false },
  { methode: 'GET', chemin: '/catalogue/produits/:id', url: '/catalogue/produits/3f6c1c2e-0000-4000-8000-000000000000', protegee: false },
  { methode: 'GET', chemin: '/catalogue/promotions', url: '/catalogue/promotions', protegee: false },
  { methode: 'GET', chemin: '/categories', url: '/categories', protegee: false },
  { methode: 'GET', chemin: '/categories/:id', url: '/categories/3f6c1c2e-0000-4000-8000-000000000000', protegee: false },
  { methode: 'GET', chemin: '/categories/:id/boutiques', url: '/categories/3f6c1c2e-0000-4000-8000-000000000000/boutiques', protegee: false },
  { methode: 'GET', chemin: '/commandes', url: '/commandes', protegee: true },
  { methode: 'POST', chemin: '/commandes', url: '/commandes', protegee: true },
  { methode: 'GET', chemin: '/commandes/:id', url: '/commandes/3f6c1c2e-0000-4000-8000-000000000000', protegee: true },
  { methode: 'PUT', chemin: '/commandes/:id/annuler', url: '/commandes/3f6c1c2e-0000-4000-8000-000000000000/annuler', protegee: true },
  { methode: 'POST', chemin: '/commandes/:id/demande-retour', url: '/commandes/3f6c1c2e-0000-4000-8000-000000000000/demande-retour', protegee: true },
  { methode: 'PATCH', chemin: '/commandes/:id/paiement', url: '/commandes/3f6c1c2e-0000-4000-8000-000000000000/paiement', protegee: true },
  { methode: 'POST', chemin: '/commandes/:id/payer', url: '/commandes/3f6c1c2e-0000-4000-8000-000000000000/payer', protegee: true },
  { methode: 'PATCH', chemin: '/commandes/:id/statut', url: '/commandes/3f6c1c2e-0000-4000-8000-000000000000/statut', protegee: true },
  { methode: 'GET', chemin: '/commandes/vendeur', url: '/commandes/vendeur', protegee: true },
  { methode: 'POST', chemin: '/commandes/vendeur', url: '/commandes/vendeur', protegee: true },
  { methode: 'POST', chemin: '/device-token/register', url: '/device-token/register', protegee: true },
  { methode: 'DELETE', chemin: '/device-token/unregister', url: '/device-token/unregister', protegee: true },
  { methode: 'GET', chemin: '/favoris', url: '/favoris', protegee: true },
  { methode: 'POST', chemin: '/favoris', url: '/favoris', protegee: true },
  { methode: 'DELETE', chemin: '/favoris/:boutiqueId', url: '/favoris/3f6c1c2e-0000-4000-8000-000000000000', protegee: true },
  { methode: 'PATCH', chemin: '/favoris/:boutiqueId/cloche', url: '/favoris/3f6c1c2e-0000-4000-8000-000000000000/cloche', protegee: true },
  { methode: 'GET', chemin: '/favoris/:boutiqueId/statut', url: '/favoris/3f6c1c2e-0000-4000-8000-000000000000/statut', protegee: true },
  { methode: 'POST', chemin: '/messages', url: '/messages', protegee: true },
  { methode: 'PUT', chemin: '/messages/:messageId/lire', url: '/messages/3f6c1c2e-0000-4000-8000-000000000000/lire', protegee: true },
  { methode: 'GET', chemin: '/messages/:userId', url: '/messages/3f6c1c2e-0000-4000-8000-000000000000', protegee: true },
  { methode: 'GET', chemin: '/messages/conversations', url: '/messages/conversations', protegee: true },
  { methode: 'GET', chemin: '/messages/non-lus', url: '/messages/non-lus', protegee: true },
  { methode: 'GET', chemin: '/notifications', url: '/notifications', protegee: true },
  { methode: 'PUT', chemin: '/notifications/:id/lire', url: '/notifications/3f6c1c2e-0000-4000-8000-000000000000/lire', protegee: true },
  { methode: 'GET', chemin: '/notifications/non-lues', url: '/notifications/non-lues', protegee: true },
  { methode: 'PUT', chemin: '/notifications/toutes-lues', url: '/notifications/toutes-lues', protegee: true },
  { methode: 'GET', chemin: '/paiement', url: '/paiement', protegee: true },
  { methode: 'GET', chemin: '/paiement/:paiementId', url: '/paiement/3f6c1c2e-0000-4000-8000-000000000000', protegee: true },
  { methode: 'POST', chemin: '/paiement/payer', url: '/paiement/payer', protegee: true },
  { methode: 'GET', chemin: '/prix-abonnement', url: '/prix-abonnement', protegee: false },
  { methode: 'GET', chemin: '/promotions', url: '/promotions', protegee: true },
  { methode: 'POST', chemin: '/promotions', url: '/promotions', protegee: true },
  { methode: 'DELETE', chemin: '/promotions/:id', url: '/promotions/3f6c1c2e-0000-4000-8000-000000000000', protegee: true },
  { methode: 'PUT', chemin: '/promotions/:id', url: '/promotions/3f6c1c2e-0000-4000-8000-000000000000', protegee: true },
  { methode: 'GET', chemin: '/promotions/actives', url: '/promotions/actives', protegee: false },
  { methode: 'POST', chemin: '/promotions/campagne', url: '/promotions/campagne', protegee: true },
  { methode: 'POST', chemin: '/signalements', url: '/signalements', protegee: true },
  { methode: 'GET', chemin: '/signalements/mes-signalements', url: '/signalements/mes-signalements', protegee: true },
  { methode: 'GET', chemin: '/vendeur/abonnes', url: '/vendeur/abonnes', protegee: true },
  { methode: 'GET', chemin: '/vendeur/abonnes/:id', url: '/vendeur/abonnes/3f6c1c2e-0000-4000-8000-000000000000', protegee: true },
  { methode: 'POST', chemin: '/vendeur/ajout-produit', url: '/vendeur/ajout-produit', protegee: true },
  { methode: 'PATCH', chemin: '/vendeur/boutique/pause', url: '/vendeur/boutique/pause', protegee: true },
  { methode: 'PATCH', chemin: '/vendeur/boutique/reactiver', url: '/vendeur/boutique/reactiver', protegee: true },
  { methode: 'POST', chemin: '/vendeur/creer-boutique', url: '/vendeur/creer-boutique', protegee: true },
  { methode: 'GET', chemin: '/vendeur/dashboard', url: '/vendeur/dashboard', protegee: true },
  { methode: 'GET', chemin: '/vendeur/historique-paiements', url: '/vendeur/historique-paiements', protegee: true },
  { methode: 'POST', chemin: '/vendeur/initier-renouvellement', url: '/vendeur/initier-renouvellement', protegee: true },
  { methode: 'GET', chemin: '/vendeur/liste-produits', url: '/vendeur/liste-produits', protegee: true },
  { methode: 'GET', chemin: '/vendeur/ma-boutique', url: '/vendeur/ma-boutique', protegee: true },
  { methode: 'DELETE', chemin: '/vendeur/ma-vitrine', url: '/vendeur/ma-vitrine', protegee: true },
  { methode: 'GET', chemin: '/vendeur/ma-vitrine', url: '/vendeur/ma-vitrine', protegee: true },
  { methode: 'PUT', chemin: '/vendeur/ma-vitrine', url: '/vendeur/ma-vitrine', protegee: true },
  { methode: 'GET', chemin: '/vendeur/ma-vitrine/apercu', url: '/vendeur/ma-vitrine/apercu', protegee: true },
  { methode: 'GET', chemin: '/vendeur/mes-conversations', url: '/vendeur/mes-conversations', protegee: true },
  { methode: 'PUT', chemin: '/vendeur/modifier-boutique', url: '/vendeur/modifier-boutique', protegee: true },
  { methode: 'PUT', chemin: '/vendeur/modifier-produit/:id', url: '/vendeur/modifier-produit/3f6c1c2e-0000-4000-8000-000000000000', protegee: true },
  { methode: 'GET', chemin: '/vendeur/mon-abonnement', url: '/vendeur/mon-abonnement', protegee: true },
  { methode: 'GET', chemin: '/vendeur/nombre-produit', url: '/vendeur/nombre-produit', protegee: true },
  { methode: 'GET', chemin: '/vendeur/nombre-produit-categorie', url: '/vendeur/nombre-produit-categorie', protegee: true },
  { methode: 'PATCH', chemin: '/vendeur/produit/:id/disponibilite', url: '/vendeur/produit/3f6c1c2e-0000-4000-8000-000000000000/disponibilite', protegee: true },
  { methode: 'POST', chemin: '/vendeur/produit/:id/dupliquer', url: '/vendeur/produit/3f6c1c2e-0000-4000-8000-000000000000/dupliquer', protegee: true },
  { methode: 'POST', chemin: '/vendeur/produit/:id/images', url: '/vendeur/produit/3f6c1c2e-0000-4000-8000-000000000000/images', protegee: true },
  { methode: 'DELETE', chemin: '/vendeur/produit/:id/images/:imageId', url: '/vendeur/produit/3f6c1c2e-0000-4000-8000-000000000000/images/3f6c1c2e-0000-4000-8000-000000000000', protegee: true },
  { methode: 'GET', chemin: '/vendeur/recherche-produits', url: '/vendeur/recherche-produits', protegee: true },
  { methode: 'POST', chemin: '/vendeur/soumettre-verification', url: '/vendeur/soumettre-verification', protegee: true },
  { methode: 'GET', chemin: '/vendeur/statistiques', url: '/vendeur/statistiques', protegee: true },
  { methode: 'GET', chemin: '/vendeur/statistiques-vues', url: '/vendeur/statistiques-vues', protegee: true },
  { methode: 'GET', chemin: '/vendeur/statut-verification', url: '/vendeur/statut-verification', protegee: true },
  { methode: 'DELETE', chemin: '/vendeur/supprimer-produit/:id', url: '/vendeur/supprimer-produit/3f6c1c2e-0000-4000-8000-000000000000', protegee: true },
  { methode: 'POST', chemin: '/vendeur/vitrine/analyser-logo', url: '/vendeur/vitrine/analyser-logo', protegee: true },
  { methode: 'POST', chemin: '/vendeur/vitrine/generer', url: '/vendeur/vitrine/generer', protegee: true },
  { methode: 'GET', chemin: '/vendeur/vitrine/secteurs', url: '/vendeur/vitrine/secteurs', protegee: true },
];

/** Envoie la requête sans jeton. */
function appeler(base, route) {
  const agent = request(app);
  const verbe = route.methode.toLowerCase();
  return agent[verbe](`${base}${route.url}`);
}

describe('Contrat des routes mobiles', () => {
  it('l\'inventaire couvre bien toutes les routes attendues', () => {
    expect(ROUTES).toHaveLength(126);
    expect(ROUTES.filter((r) => r.protegee)).toHaveLength(103);
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

  describe('protection par jeton', () => {
    const protegees = ROUTES.filter((r) => r.protegee);

    it.each(protegees.map((r) => [`${r.methode} ${r.chemin}`, r]))(
      '%s refuse une requête sans jeton',
      async (_nom, route) => {
        const res = await appeler('/saambiz/v1', route);
        expect(res.status).toBe(401);
      },
    );
  });

  describe('routes publiques', () => {
    const publiques = ROUTES.filter((r) => !r.protegee);

    it.each(publiques.map((r) => [`${r.methode} ${r.chemin}`, r]))(
      '%s reste accessible sans jeton',
      async (_nom, route) => {
        const res = await appeler('/saambiz/v1', route);
        // Ni 401 ni 403 : ces routes s'adressent à des visiteurs sans compte.
        expect([401, 403]).not.toContain(res.status);
      },
    );
  });
});
