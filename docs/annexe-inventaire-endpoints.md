# Annexe — Inventaire exhaustif des endpoints et de leurs cinq contrôles

**Date** : 23 novembre 2026 · **Dépôt** : `Saambiz_Back`, arbre local au commit `d0231d2`
**Annexe de** : [`audit-securite-2026-11-23.md`](audit-securite-2026-11-23.md)

## Comment cette table a été produite

Elle n'est pas recopiée à la main. Trois sources, recoupées :

1. **La liste des routes** vient de `scripts/routes.py`, l'outil du dépôt lui-même —
   celui qui engendre déjà les tests de contrat. Il rend **227 routes**.
2. **Les chaînes de middlewares** sont extraites par analyse à parenthésage
   équilibré de chaque appel `router.<verbe>(…)`, en tenant compte des
   `router.use(fn)` déclarés **avant** chaque route dans le même fichier — ce qui
   est la sémantique réelle d'Express. Un simple `grep` par ligne manquait les
   routes déclarées sur plusieurs lignes, qui sont la majorité ici.
3. **La colonne « propriété de la ressource »** vient d'un crible automatique :
   pour chaque route portant un identifiant d'URL, le corps du gestionnaire est
   localisé en résolvant les `require` du fichier de route, puis on regarde s'il
   transmet au service **l'identité de l'appelant** (`req.user`) en plus de
   l'identifiant (`req.params`). Les cas signalés ont ensuite été vérifiés un par
   un dans le service appelé.

Recoupement de sûreté : un parcours de la pile du routeur Express **réellement
chargé** a donné 210 chemins uniques avant correction de l'extraction des
préfixes ; `routes.py` et l'analyse syntaxique donnent tous deux **227**. C'est ce
chiffre qui est retenu.

## Les cinq colonnes de contrôle

| Colonne | Ce qu'elle dit | Ce qu'elle ne dit pas |
|---|---|---|
| **1. Authentification** | `OUI` = `authMiddleware` dans la chaîne · `OPTIONNELLE` = `authOptionnel` · `NON` = route ouverte | Si le jeton est bien vérifié (voir E-04 du rapport : algorithme non épinglé) |
| **2. Rôle / permission** | Le garde de rôle (`isAdmin`/`isVendeur`/`isAcheteur`) et la permission fine `MENU/action` | — |
| **3. Tenant** | La clé qui borne les données au vendeur, à l'acheteur ou au porteur du jeton | — |
| **4. Propriété de la ressource** | `OUI` = le gestionnaire transmet identité **et** identifiant, et le service borne sa clause `where` (vérifié individuellement) | — |
| **5. Validation** | Le schéma Joi posé au bord de la route, ou la vérification de signature de fichier | **Pas** la validation faite à la main dans le contrôleur ou le service, qui existe souvent (voir plus bas) |

## Comment lire la colonne « Consommateur »

C'est la frontière de ta contrainte de périmètre — « les modifs concernent l'admin,
évite de toucher les API du mobile qui sont déjà bonnes » :

| Consommateur | Routes | Ce que je m'autorise |
|---|---|---|
| **ADMIN** | **84** | Je peux corriger |
| MOBILE | 135 | Je **documente seulement**, je ne touche pas au contrat |
| VITRINE | 6 | Site public d'une boutique — je documente |
| WEBHOOK | 2 | Opérateurs de paiement — je documente |
| **Total** | **227** | |

Ces 84 et 135 ne sont pas une estimation : `admin.route.js` (74) +
`adminManagement.route.js` (10) = 84, et le contrat mobile engendré par le dépôt
(`tests/integration/contratRoutesMobile.http.test.js`) annonce de son côté
« 135 routes, dont 109 protégées ». Les deux comptes se recoupent exactement.

## Ce que la colonne 5 ne dit pas — à lire avant de conclure

**196 routes sur 227 n'ont pas de schéma Joi** au bord de la route : 108 lectures
`GET` (sans corps) et **88 écritures**, dont **48 côté admin**.

Ce chiffre est brut et serait trompeur seul : « sans schéma Joi » ne veut pas dire
« sans validation ». Trois exemples vérifiés :

- `POST /admin/vendeurs` et `PUT /admin/vendeur/:id` passent `req.body` entier au
  service — mais celui-ci le filtre par **liste blanche par déstructuration**
  (`admin.service.js:347`, `_identite` : seuls `prenom`, `nom`, `email`,
  `telephone`, `adresse`), puis valide le format de l'email et du téléphone et
  l'unicité. `role`, `statut`, `verifie` et `soldeDisponible` sont **inatteignables**.
- `POST /admin/rbac/admins` valide `nom`, `prenom` et `email` dans le contrôleur
  (`adminManagement.controller.js:23-25`).
- `POST /admin/notification-globale` exige `titre` et `message`
  (`admin.controller.js:285`).

Le vrai manque n'est donc pas « il n'y a pas de validation » mais : **elle est
dispersée, formulée différemment d'un endroit à l'autre, et le format des
identifiants d'URL n'est presque jamais contrôlé**. Un seul middleware de
validation des paramètres fermerait d'un coup la quarantaine de routes qui
transmettent un `:id` non vérifié à Sequelize — et le dépôt sait déjà que c'est un
problème : `vendeur.service.js:611-612` le corrige localement en disant
« Un identifiant mal formé ferait échouer la requête SQL en erreur 500 ».

---

## La table

| Consommateur | Endpoint | 1. Authentification | 2. Rôle / permission | 3. Tenant | 4. Propriété de la ressource | 5. Validation | Autres gardes |
|---|---|---|---|---|---|---|---|
| **ADMIN** | `POST /admin/abonnement-manuel/:vendeurId` | OUI | Admin + `ABONNEMENTS/create` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `PUT /admin/abonnement/:id/revoquer` | OUI | Admin + `ABONNEMENTS/update` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `GET /admin/abonnements` | OUI | Admin + `ABONNEMENTS/view` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `GET /admin/abonnements-expiration` | OUI | Admin + `ABONNEMENTS/view` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `DELETE /admin/acheteur/:id` | OUI | Admin + `ACHETEURS/delete` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `PUT /admin/acheteur/:id` | OUI | Admin + `ACHETEURS/update` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `PUT /admin/acheteur/:id/activer` | OUI | Admin + `ACHETEURS/update` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `PUT /admin/acheteur/:id/suspendre` | OUI | Admin + `ACHETEURS/update` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `POST /admin/acheteurs` | OUI | Admin + `ACHETEURS/create` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `POST /admin/ajout-categorie` | OUI | Admin + `CATEGORIES/create` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `GET /admin/audit-logs` | OUI | Admin + `ADMINS/view` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `GET /admin/audit-logs/resume` | OUI | Admin + `ADMINS/view` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `DELETE /admin/boutique/:id` | OUI | Admin + `VENDEURS/delete` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `DELETE /admin/boutique/:id/site` | OUI | Admin + `VENDEURS/delete` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `PUT /admin/boutique/:id/site` | OUI | Admin + `VENDEURS/update` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `GET /admin/boutiques-options` | OUI | Admin + `[PRODUITS/COMMANDES]/view` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `DELETE /admin/categorie/:id` | OUI | Admin + `CATEGORIES/delete` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `PUT /admin/categorie/:id` | OUI | Admin + `CATEGORIES/update` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `GET /admin/categories` | OUI | Admin + `CATEGORIES/view` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `PUT /admin/categories/ordre` | OUI | Admin + `CATEGORIES/update` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `GET /admin/centre-aide` | OUI | Admin + `CONFIG/view` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `PUT /admin/centre-aide/contacts` | OUI | Admin + `CONFIG/update` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `POST /admin/centre-aide/questions` | OUI | Admin + `CONFIG/create` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `DELETE /admin/centre-aide/questions/:id` | OUI | Admin + `CONFIG/update` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `PUT /admin/centre-aide/questions/:id` | OUI | Admin + `CONFIG/update` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `PUT /admin/centre-aide/questions/ordre` | OUI | Admin + `CONFIG/update` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `DELETE /admin/commande/:id` | OUI | Admin + `COMMANDES/delete` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `GET /admin/commande/:id` | OUI | Admin + `COMMANDES/view` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `PUT /admin/commande/:id` | OUI | Admin + `COMMANDES/update` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `GET /admin/commandes` | OUI | Admin + `COMMANDES/view` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `POST /admin/commandes` | OUI | Admin + `COMMANDES/create` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `GET /admin/configs` | OUI | Admin + `CONFIG/view` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `POST /admin/configs` | OUI | Admin + `CONFIG/create` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `PUT /admin/configs/:cle` | OUI | Admin + `CONFIG/update` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `GET /admin/configs/prix-abonnement` | OUI | Admin + `CONFIG/view` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `GET /admin/demandes-retour` | OUI | Admin + `COMMANDES/view` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `PUT /admin/demandes-retour/:id/traiter` | OUI | Admin + `COMMANDES/update` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `GET /admin/inscriptions-mensuelles` | OUI | Admin + `DASHBOARD/view` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `GET /admin/liste-clients` | OUI | Admin + `ACHETEURS/view` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `GET /admin/liste-produits-actifs` | OUI | Admin + `PRODUITS/view` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `GET /admin/liste-vendeurs` | OUI | Admin + `VENDEURS/view` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `GET /admin/nombre-clients-actifs` | OUI | Admin + `DASHBOARD/view` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `GET /admin/nombre-clients-inactifs` | OUI | Admin + `DASHBOARD/view` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `GET /admin/nombre-produits-actifs` | OUI | Admin + `DASHBOARD/view` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `GET /admin/nombre-vendeurs-actif` | OUI | Admin + `DASHBOARD/view` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `GET /admin/nombre-vendeurs-inactif` | OUI | Admin + `DASHBOARD/view` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `POST /admin/notification-globale` | OUI | Admin + `ADMINS/create` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `GET /admin/paiements` | OUI | Admin + `PAIEMENTS/view` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `GET /admin/paiements/echecs` | OUI | Admin + `PAIEMENTS/view` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `PUT /admin/prix-abonnement` | OUI | Admin + `ABONNEMENTS/update` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `DELETE /admin/produit/:id` | OUI | Admin + `PRODUITS/delete` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `GET /admin/produit/:id` | OUI | Admin + `PRODUITS/view` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `PUT /admin/produit/:id` | OUI | Admin + `PRODUITS/update` | plateforme *(par conception)* | s.o. *(admin global)* | fichier (magic bytes) | compte actif |
| **ADMIN** | `PUT /admin/produit/:id/approuver` | OUI | Admin + `MODERATION/update` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `PUT /admin/produit/:id/rejeter` | OUI | Admin + `MODERATION/update` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `GET /admin/produits` | OUI | Admin + `PRODUITS/view` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `POST /admin/produits` | OUI | Admin + `PRODUITS/create` | plateforme *(par conception)* | s.o. *(vue plateforme)* | fichier (magic bytes) | compte actif |
| **ADMIN** | `GET /admin/produits-en-attente` | OUI | Admin + `MODERATION/view` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `GET /admin/rbac/admins` | OUI | Admin + `ADMINS/view` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `POST /admin/rbac/admins` | OUI | Admin + `ADMINS/create` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `DELETE /admin/rbac/admins/:userId` | OUI | Admin + `ADMINS/delete` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `PUT /admin/rbac/admins/:userId` | OUI | Admin + `ADMINS/update` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `GET /admin/rbac/admins/:userId/permissions` | OUI | Admin + `ADMINS/view` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `PUT /admin/rbac/admins/:userId/permissions` | OUI | Admin + `ADMINS/update` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `GET /admin/rbac/menus` | OUI | Admin + `ADMINS/view` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `POST /admin/rbac/menus` | OUI | Admin + `MENUS/create` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `DELETE /admin/rbac/menus/:id` | OUI | Admin + `MENUS/delete` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `PUT /admin/rbac/menus/:id` | OUI | Admin + `MENUS/update` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `GET /admin/revenus-mensuels` | OUI | Admin + `DASHBOARD/view` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `PUT /admin/signalement/:id/rejeter` | OUI | Admin + `SIGNALEMENTS/update` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `PUT /admin/signalement/:id/traiter` | OUI | Admin + `SIGNALEMENTS/update` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `GET /admin/signalements` | OUI | Admin + `SIGNALEMENTS/view` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `GET /admin/stats-ecommerce` | OUI | Admin + `DASHBOARD/view` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `GET /admin/stats-globales` | OUI | Admin + `DASHBOARD/view` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `DELETE /admin/supprimer-utilisateur/:id` | OUI | Admin + `ADMINS/delete` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `DELETE /admin/vendeur/:id` | OUI | Admin + `VENDEURS/delete` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `PUT /admin/vendeur/:id` | OUI | Admin + `VENDEURS/update` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `PUT /admin/vendeur/:id/activer` | OUI | Admin + `VENDEURS/update` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `PUT /admin/vendeur/:id/rejeter` | OUI | Admin + `VALIDATION_VENDEURS/update` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `PUT /admin/vendeur/:id/suspendre` | OUI | Admin + `VENDEURS/update` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `PUT /admin/vendeur/:id/valider` | OUI | Admin + `VALIDATION_VENDEURS/update` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `PUT /admin/vendeur/:id/verifier` | OUI | Admin + `VALIDATION_VENDEURS/update` | plateforme *(par conception)* | s.o. *(admin global)* | — | compte actif |
| **ADMIN** | `POST /admin/vendeurs` | OUI | Admin + `VENDEURS/create` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| **ADMIN** | `GET /admin/vendeurs-a-valider` | OUI | Admin + `VALIDATION_VENDEURS/view` | plateforme *(par conception)* | s.o. *(vue plateforme)* | — | compte actif |
| MOBILE | `PUT /account/change-password` | OUI | — | `req.user.id` | borné au porteur du jeton | `changePasswordSchema` | compte actif |
| MOBILE | `POST /account/forgot-password` | OUI | — | `req.user.id` | borné au porteur du jeton | `forgotPasswordSchema` | plafond dédié |
| MOBILE | `DELETE /account/me` | OUI | — | `req.user.id` | borné au porteur du jeton | — | compte actif |
| MOBILE | `GET /account/me` | OUI | — | `req.user.id` | borné au porteur du jeton | — | compte actif |
| MOBILE | `PUT /account/modifier-profil` | OUI | — | `req.user.id` | borné au porteur du jeton | `modifierProfilSchema` | compte actif |
| MOBILE | `POST /account/reset-password` | OUI | — | `req.user.id` | borné au porteur du jeton | `resetPasswordSchema` | plafond dédié |
| MOBILE | `GET /acheteurs/accueil` | OUI | — | `req.user.id` | borné au porteur du jeton | — | — |
| MOBILE | `GET /acheteurs/accueil-personnalise` | OPTIONNELLE | — | public | s.o. *(lecture publique)* | — | — |
| MOBILE | `GET /acheteurs/accueil-section/:cle` | OPTIONNELLE | — | public | catalogue public *(voir N-01)* | — | — |
| MOBILE | `GET /acheteurs/boutique/:id` | OUI | — | `req.user.id` | catalogue public *(voir N-01)* | — | — |
| MOBILE | `GET /acheteurs/boutiques-proches` | OUI | — | `req.user.id` | borné au porteur du jeton | — | — |
| MOBILE | `GET /acheteurs/boutiques-verifiees` | OUI | — | `req.user.id` | borné au porteur du jeton | — | — |
| MOBILE | `GET /acheteurs/contacter-vendeur-par-whatsapp/:id` | OUI | — | `req.user.id` | catalogue public *(voir N-01)* | — | — |
| MOBILE | `GET /acheteurs/decouverte` | OUI | — | `req.user.id` | borné au porteur du jeton | — | — |
| MOBILE | `GET /acheteurs/filtrer-produit-ville` | OUI | — | `req.user.id` | borné au porteur du jeton | — | — |
| MOBILE | `GET /acheteurs/liste-boutiques` | OUI | — | `req.user.id` | borné au porteur du jeton | — | — |
| MOBILE | `GET /acheteurs/liste-produit-par-boutique/:boutiqueId` | OUI | — | `req.user.id` | catalogue public *(voir N-01)* | — | — |
| MOBILE | `GET /acheteurs/liste-produits` | OUI | — | `req.user.id` | borné au porteur du jeton | — | — |
| MOBILE | `GET /acheteurs/mes-conversations` | OUI | — | `req.user.id` | borné au porteur du jeton | — | — |
| MOBILE | `GET /acheteurs/mon-tableau-de-bord` | OUI | — | `req.user.id` | borné au porteur du jeton | — | — |
| MOBILE | `GET /acheteurs/nouvelles-boutiques` | OUI | — | `req.user.id` | borné au porteur du jeton | — | — |
| MOBILE | `GET /acheteurs/preferences` | OUI | — | `req.user.id` | borné au porteur du jeton | — | — |
| MOBILE | `PUT /acheteurs/preferences` | OUI | — | `req.user.id` | borné au porteur du jeton | — | — |
| MOBILE | `GET /acheteurs/produit/:id` | OUI | — | `req.user.id` | catalogue public *(voir N-01)* | — | — |
| MOBILE | `POST /acheteurs/produit/:id/vue` | OUI | — | `req.user.id` | catalogue public *(voir N-01)* | — | — |
| MOBILE | `GET /acheteurs/produits` | OUI | — | `req.user.id` | borné au porteur du jeton | — | — |
| MOBILE | `GET /acheteurs/produits-tendance` | OUI | — | `req.user.id` | borné au porteur du jeton | — | — |
| MOBILE | `GET /acheteurs/promotions-actives` | OUI | — | `req.user.id` | borné au porteur du jeton | — | — |
| MOBILE | `GET /acheteurs/recherche` | OUI | — | `req.user.id` | borné au porteur du jeton | — | — |
| MOBILE | `GET /acheteurs/rechercher-produit-categorie` | OUI | — | `req.user.id` | borné au porteur du jeton | — | — |
| MOBILE | `GET /app/config` | NON | — | public | s.o. *(route publique)* | — | — |
| MOBILE | `POST /auth/changer-mot-de-passe` | OUI | — | `req.user.id` | borné au porteur du jeton | — | — |
| MOBILE | `POST /auth/inscription/envoyer-code` | NON | — | public | s.o. *(route publique)* | `envoyerCodeInscriptionSchema` | plafond dédié |
| MOBILE | `POST /auth/inscription/verifier-code` | NON | — | public | s.o. *(route publique)* | `verifierCodeInscriptionSchema` | plafond dédié |
| MOBILE | `POST /auth/login` | NON | — | public | s.o. *(route publique)* | `loginSchema` | plafond dédié |
| MOBILE | `POST /auth/logout` | OUI | — | `req.user.id` | borné au porteur du jeton | — | — |
| MOBILE | `POST /auth/refresh` | NON | — | public | s.o. *(route publique)* | — | — |
| MOBILE | `POST /auth/register` | NON | — | public | s.o. *(route publique)* | `registerSchema` | — |
| MOBILE | `POST /auth/resend-verification` | NON | — | public | s.o. *(route publique)* | — | plafond dédié |
| MOBILE | `POST /auth/social` | NON | — | public | s.o. *(route publique)* | `connexionSocialeSchema` | plafond dédié |
| MOBILE | `GET /auth/verify-email` | NON | — | public | s.o. *(route publique)* | — | — |
| MOBILE | `POST /auth/verify-email` | NON | — | public | s.o. *(route publique)* | — | plafond dédié |
| MOBILE | `POST /avis` | OUI | Acheteur | `acheteurId` | borné au porteur du jeton | — | compte actif |
| MOBILE | `DELETE /avis/boutique/:boutiqueId` | OUI | Acheteur | `acheteurId` | **OUI** — identité + identifiant | — | compte actif |
| MOBILE | `GET /avis/boutique/:boutiqueId` | NON | — | public | s.o. *(public)* | — | — |
| MOBILE | `GET /avis/boutique/:boutiqueId/mon-avis` | OUI | Acheteur | `acheteurId` | **OUI** — identité + identifiant | — | compte actif |
| MOBILE | `GET /catalogue/boutiques` | OPTIONNELLE | — | public | s.o. *(lecture publique)* | — | — |
| MOBILE | `GET /catalogue/boutiques/:id` | OPTIONNELLE | — | public | **OUI** — identité + identifiant | — | — |
| MOBILE | `GET /catalogue/produits` | OPTIONNELLE | — | public | s.o. *(lecture publique)* | — | — |
| MOBILE | `GET /catalogue/produits/:id` | OPTIONNELLE | — | public | **OUI** — identité + identifiant | — | — |
| MOBILE | `GET /catalogue/promotions` | OPTIONNELLE | — | public | s.o. *(lecture publique)* | — | — |
| MOBILE | `GET /categories` | NON | — | public | s.o. *(route publique)* | — | — |
| MOBILE | `GET /categories/:id` | NON | — | public | s.o. *(public)* | — | — |
| MOBILE | `GET /categories/:id/boutiques` | NON | — | public | s.o. *(public)* | — | — |
| MOBILE | `GET /centre-aide` | NON | — | public | s.o. *(route publique)* | — | — |
| MOBILE | `GET /commandes` | OUI | Acheteur | `acheteurId` | borné au porteur du jeton | — | compte actif |
| MOBILE | `POST /commandes` | OUI | Acheteur | `acheteurId` | borné au porteur du jeton | `creerCommandeSchema` | compte actif |
| MOBILE | `GET /commandes/:id` | OUI | — | `req.user.id` | **OUI** — identité + identifiant | — | compte actif |
| MOBILE | `PUT /commandes/:id/annuler` | OUI | Acheteur | `acheteurId` | **OUI** — identité + identifiant | — | compte actif |
| MOBILE | `PATCH /commandes/:id/demande-annulation` | OUI | Vendeur | `vendeurId` | **OUI** — identité + identifiant | `repondreAnnulationSchema` | compte actif |
| MOBILE | `POST /commandes/:id/demande-annulation` | OUI | Acheteur | `acheteurId` | **OUI** — identité + identifiant | `demanderAnnulationSchema` | compte actif |
| MOBILE | `POST /commandes/:id/demande-retour` | OUI | Acheteur | `acheteurId` | **OUI** — identité + identifiant | `creerDemandeRetourSchema` | compte actif |
| MOBILE | `PATCH /commandes/:id/paiement` | OUI | Vendeur | `vendeurId` | **OUI** — identité + identifiant | — | compte actif |
| MOBILE | `POST /commandes/:id/payer` | OUI | Acheteur | `acheteurId` | **OUI** — identité + identifiant | `payerCommandeSchema` | compte actif |
| MOBILE | `PATCH /commandes/:id/statut` | OUI | Vendeur | `vendeurId` | **OUI** — identité + identifiant | `changerStatutSchema` | compte actif |
| MOBILE | `GET /commandes/vendeur` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | — | compte actif |
| MOBILE | `POST /commandes/vendeur` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | `creerCommandeVendeurSchema` | compte actif |
| MOBILE | `POST /device-token/register` | OUI | — | `req.user.id` | borné au porteur du jeton | — | — |
| MOBILE | `DELETE /device-token/unregister` | OUI | — | `req.user.id` | borné au porteur du jeton | — | — |
| MOBILE | `GET /favoris` | OUI | Acheteur | `acheteurId` | borné au porteur du jeton | — | compte actif |
| MOBILE | `POST /favoris` | OUI | Acheteur | `acheteurId` | borné au porteur du jeton | — | compte actif |
| MOBILE | `DELETE /favoris/:boutiqueId` | OUI | Acheteur | `acheteurId` | **OUI** — identité + identifiant | — | compte actif |
| MOBILE | `PATCH /favoris/:boutiqueId/cloche` | OUI | Acheteur | `acheteurId` | **OUI** — identité + identifiant | — | compte actif |
| MOBILE | `GET /favoris/:boutiqueId/statut` | OUI | Acheteur | `acheteurId` | **OUI** — identité + identifiant | — | compte actif |
| MOBILE | `POST /messages` | OUI | — | `req.user.id` | borné au porteur du jeton | `envoyerMessageSchema` | compte actif |
| MOBILE | `PUT /messages/:messageId/lire` | OUI | — | `req.user.id` | **OUI** — identité + identifiant | — | compte actif |
| MOBILE | `GET /messages/:userId` | OUI | — | `req.user.id` | **OUI** — identité + identifiant | — | compte actif |
| MOBILE | `GET /messages/conversations` | OUI | — | `req.user.id` | borné au porteur du jeton | — | compte actif |
| MOBILE | `GET /messages/non-lus` | OUI | — | `req.user.id` | borné au porteur du jeton | — | compte actif |
| MOBILE | `GET /messages/site` | OUI | — | `req.user.id` | borné au porteur du jeton | — | compte actif |
| MOBILE | `DELETE /messages/site/:id` | OUI | — | `req.user.id` | **OUI** — identité + identifiant | — | compte actif |
| MOBILE | `PUT /messages/site/:id/lire` | OUI | — | `req.user.id` | **OUI** — identité + identifiant | — | compte actif |
| MOBILE | `GET /notifications` | OUI | — | `req.user.id` | borné au porteur du jeton | — | compte actif |
| MOBILE | `PUT /notifications/:id/lire` | OUI | — | `req.user.id` | **OUI** — identité + identifiant | — | compte actif |
| MOBILE | `GET /notifications/non-lues` | OUI | — | `req.user.id` | borné au porteur du jeton | — | compte actif |
| MOBILE | `PUT /notifications/toutes-lues` | OUI | — | `req.user.id` | borné au porteur du jeton | — | compte actif |
| MOBILE | `GET /paiement` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | — | compte actif |
| MOBILE | `GET /paiement/:paiementId` | OUI | Vendeur | `vendeurId` | **OUI** — identité + identifiant | — | compte actif |
| MOBILE | `POST /paiement/payer` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | — | compte actif |
lignes engendrees : 227
| MOBILE | `GET /prix-abonnement` | NON | — | public | s.o. *(route publique)* | — | — |
| MOBILE | `GET /promotions` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | — | compte actif |
| MOBILE | `POST /promotions` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | `creerPromotionSchema` | compte actif, abonnement |
| MOBILE | `DELETE /promotions/:id` | OUI | Vendeur | `vendeurId` | **OUI** — identité + identifiant | — | compte actif |
| MOBILE | `PUT /promotions/:id` | OUI | Vendeur | `vendeurId` | **OUI** — identité + identifiant | `modifierPromotionSchema` | compte actif, abonnement |
| MOBILE | `GET /promotions/actives` | NON | — | public | s.o. *(route publique)* | — | — |
| MOBILE | `POST /promotions/campagne` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | fichier (magic bytes) | compte actif, abonnement |
| MOBILE | `POST /signalements` | OUI | Acheteur | `acheteurId` | borné au porteur du jeton | — | — |
| MOBILE | `GET /signalements/mes-signalements` | OUI | — | `req.user.id` | borné au porteur du jeton | — | — |
| MOBILE | `GET /vendeur/abonnes` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | — | compte actif |
| MOBILE | `GET /vendeur/abonnes/:id` | OUI | Vendeur | `vendeurId` | **OUI** — identité + identifiant | — | compte actif |
| MOBILE | `POST /vendeur/ajout-produit` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | fichier (magic bytes) | compte actif, abonnement |
| MOBILE | `PATCH /vendeur/boutique/pause` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | — | compte actif |
| MOBILE | `PATCH /vendeur/boutique/reactiver` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | — | compte actif |
| MOBILE | `POST /vendeur/creer-boutique` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | fichier (magic bytes) | compte actif |
| MOBILE | `GET /vendeur/dashboard` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | — | compte actif |
| MOBILE | `GET /vendeur/historique-paiements` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | — | compte actif |
| MOBILE | `POST /vendeur/initier-renouvellement` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | — | compte actif |
| MOBILE | `GET /vendeur/liste-produits` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | — | compte actif |
| MOBILE | `GET /vendeur/ma-boutique` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | — | compte actif |
| MOBILE | `DELETE /vendeur/ma-vitrine` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | — | compte actif |
| MOBILE | `GET /vendeur/ma-vitrine` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | — | compte actif |
| MOBILE | `PUT /vendeur/ma-vitrine` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | — | compte actif, abonnement |
| MOBILE | `GET /vendeur/ma-vitrine/apercu` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | — | compte actif |
| MOBILE | `POST /vendeur/ma-vitrine/photos` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | fichier (magic bytes) | compte actif, abonnement |
| MOBILE | `DELETE /vendeur/ma-vitrine/photos/:photoId` | OUI | Vendeur | `vendeurId` | **OUI** — identité + identifiant | — | compte actif |
| MOBILE | `PUT /vendeur/ma-vitrine/photos/ordre` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | — | compte actif, abonnement |
| MOBILE | `GET /vendeur/mes-conversations` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | — | compte actif |
| MOBILE | `PUT /vendeur/modifier-boutique` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | fichier (magic bytes) | compte actif |
| MOBILE | `PUT /vendeur/modifier-produit/:id` | OUI | Vendeur | `vendeurId` | **OUI** — identité + identifiant | fichier (magic bytes) | compte actif, abonnement |
| MOBILE | `GET /vendeur/mon-abonnement` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | — | compte actif |
| MOBILE | `GET /vendeur/nombre-produit` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | — | compte actif |
| MOBILE | `GET /vendeur/nombre-produit-categorie` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | — | compte actif |
| MOBILE | `PATCH /vendeur/produit/:id/disponibilite` | OUI | Vendeur | `vendeurId` | **OUI** — identité + identifiant | — | compte actif, abonnement |
| MOBILE | `POST /vendeur/produit/:id/dupliquer` | OUI | Vendeur | `vendeurId` | **OUI** — identité + identifiant | — | compte actif, abonnement |
| MOBILE | `POST /vendeur/produit/:id/images` | OUI | Vendeur | `vendeurId` | **OUI** — identité + identifiant | fichier (magic bytes) | compte actif, abonnement |
| MOBILE | `DELETE /vendeur/produit/:id/images/:imageId` | OUI | Vendeur | `vendeurId` | **OUI** — identité + identifiant | — | compte actif, abonnement |
| MOBILE | `GET /vendeur/recherche-produits` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | — | compte actif |
| MOBILE | `POST /vendeur/soumettre-verification` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | fichier (magic bytes) | compte actif |
| MOBILE | `GET /vendeur/statistiques` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | — | compte actif |
| MOBILE | `GET /vendeur/statistiques-vues` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | — | compte actif |
| MOBILE | `GET /vendeur/statut-verification` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | — | compte actif |
| MOBILE | `DELETE /vendeur/supprimer-produit/:id` | OUI | Vendeur | `vendeurId` | **OUI** — identité + identifiant | — | compte actif, abonnement |
| MOBILE | `POST /vendeur/vitrine/analyser-logo` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | fichier (magic bytes) | compte actif |
| MOBILE | `POST /vendeur/vitrine/generer` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | fichier (magic bytes) | compte actif |
| MOBILE | `GET /vendeur/vitrine/secteurs` | OUI | Vendeur | `vendeurId` | borné au porteur du jeton | — | compte actif |
| VITRINE | `GET /vitrine/:slug` | NON | — | public | s.o. *(public)* | — | — |
| VITRINE | `POST /vitrine/:slug/commande` | NON | — | public | s.o. *(public)* | — | plafond dédié |
| VITRINE | `POST /vitrine/:slug/message` | NON | — | public | s.o. *(public)* | — | plafond dédié |
| VITRINE | `GET /vitrine/:slug/produits` | NON | — | public | s.o. *(public)* | — | — |
| VITRINE | `GET /vitrine/:slug/produits/:produitId` | NON | — | public | s.o. *(public)* | — | — |
| VITRINE | `GET /vitrine/commande/:reference` | NON | — | public | s.o. *(public)* | — | plafond dédié |
| WEBHOOK | `POST /paiement/webhook/orange` | NON | — | signature HMAC | s.o. *(route publique)* | — | — |
| WEBHOOK | `POST /paiement/webhook/wave` | NON | — | signature HMAC | s.o. *(route publique)* | — | — |
