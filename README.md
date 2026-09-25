# SaamBiz — API

API Node/Express + PostgreSQL de la marketplace. Sert les cinq clients du
dépôt : administration, espace vendeur, site public et vitrines des boutiques,
application mobile.

Adresse de référence : `http://localhost:5000/saambiz/v1`

> Ce fichier contenait auparavant un `.env` complet, secrets en clair compris.
> Aucun secret ne doit revenir ici : la configuration se décrit dans
> [`.env.example`](.env.example), avec des valeurs d'exemple uniquement.

## Démarrer

```bash
cp .env.example .env          # puis remplir les valeurs
docker compose up -d --build
```

Le conteneur est clé en main : au démarrage, `src/seed/bootstrap.js` attend
PostgreSQL, crée les tables manquantes, applique les migrations SQL, puis lance
le seed idempotent (menus, compte d'administration, catégories). Il n'y a ni
base ni jeu de données à préparer à la main.

Compte d'administration : `ADMIN_EMAIL` / `ADMIN_PASSWORD` du `.env`.

Sans Docker :

```bash
npm install
npm run migrate && npm run seed
npm run dev
```

## Commandes

| Commande | Effet |
|---|---|
| `npm run dev` | nodemon sur `src/server.js` |
| `npm start` | démarrage simple |
| `npm test` | Jest — 112 tests (unitaires + intégration HTTP) |
| `npm run test:coverage` | couverture |
| `npm run migrate` | migrations SQL seules |
| `npm run seed` | menus + admin + catégories (idempotent) |
| `npm run docker:dev` | stack de développement |
| `npm run docker:prod` | stack de production |
| `npm run backup` | sauvegarde PostgreSQL (`deploy/backup-postgres.sh`) |

## Après une modification du code

L'image embarque le code (`COPY . .`) :

```bash
docker compose up -d --build backend   # et NON `restart`
```

Un `restart` relance l'ancienne image sans le moindre avertissement.

## Migrations

`sequelize.sync({ force: false })` crée les **tables** absentes, jamais les
**colonnes** ajoutées à une table qui existe déjà. Déclarer un champ dans un
modèle ne suffit donc pas sur une base peuplée : il faut un fichier SQL dans
[`migrations/`](migrations/), horodaté. Le bootstrap les applique dans l'ordre
des noms et consigne celles déjà passées dans la table `migration_appliquee`.

Les deux fichiers compose lancent le bootstrap avant le serveur. Un
`docker-compose` qui ne le fait pas déploie sans migrer : le service démarre,
`/health` répond 200, et les routes touchant une colonne récente échouent sur
« column … does not exist ».

## Architecture

```
route → middlewares → controller → service → model
```

Un contrôleur ne fait aucune requête SQL. Un service ne touche jamais à `res`.

```
src/
├── app.js server.js
├── config/       db · security (source unique de la config de sécurité)
├── routes/ controllers/ services/    mêmes sous-dossiers par rôle
├── models/       + index.js = toutes les associations
├── middlewares/  auth · checkActiveUser · isAdmin · requirePermission
│                 validate · upload · asyncHandler · errorHandler
├── errors/       AppError et ses six sous-classes
├── validators/ validations/          schémas Joi
├── utils/        response · logger · paginate
├── jobs/         crons (abonnements, promotions, purges)
└── seed/         bootstrap · migrate · seeds idempotents
```

Chaîne d'autorisation : `auth` → `checkActiveUser` → `isAdmin` →
`requirePermission('MENU', 'action')`. Le modèle est strict — aucune permission
enregistrée, aucun accès.

Les contrôleurs sont enveloppés dans `asyncHandler` **à l'export**, pas dans les
routes. Lever une `AppError` typée depuis un service suffit : le gestionnaire
global traduit aussi Sequelize, JWT, Multer, le JSON malformé et le 413.

## Sécurité

`config/security.js` valide sa configuration au chargement du module, donc avant
qu'Express n'écoute. Le démarrage est refusé si un secret JWT manque ou fait
moins de 32 caractères, si deux secrets portent la même valeur, si une valeur
d'exemple traîne en production, ou si `CORS_ORIGIN` y est vide, jokerisée, ou
remplie d'adresses locales.

En développement, toute origine locale est acceptée quel que soit son port :
Flutter Web en tire un nouveau à chaque lancement, et le navigateur masque un
refus CORS derrière un « XMLHttpRequest error » que rien n'explique.

## Deux préfixes

`/saambiz/v1/…` est l'adresse de référence. `/saambiz/…` reste servie en alias
pour l'application mobile déjà installée, avec un en-tête `Deprecation: true`.
`/jendal/…` est réécrit vers `/saambiz/…` — vestige de l'ancien nom du projet.
Les deux derniers disparaîtront quand le trafic résiduel sera nul ; ne les
visez pas depuis un nouvel environnement.

## Quatre tables en camelCase

`message`, `notification`, `promotion` et `user_otp` ne déclarent pas
`underscored: true` : leurs colonnes sont restées en `destinataireId`,
`utilisateurId`… En SQL brut, elles doivent être citées entre guillemets, sinon
PostgreSQL les met en minuscules et ne les trouve pas.
