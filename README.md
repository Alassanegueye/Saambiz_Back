# SaamBiz — API

API Node/Express + PostgreSQL de la marketplace. Sert les cinq clients du
dépôt : administration, espace vendeur, site public et vitrines des boutiques,
application mobile.

Adresse de référence : `http://localhost:5000/saambiz/v1`

**Nouveau sur le projet ?** Commencez par [`DEMARRAGE.md`](DEMARRAGE.md) : les
cinq dépôts, comment les cloner côte à côte, et les pièges qui coûtent le plus
de temps. [`CLAUDE.md`](CLAUDE.md) en tient la version longue. Les deux vivent
ici parce que ce dépôt sert de point d'entrée — les quatre autres ne portent
que leur propre application.

**Vous déployez ?** L'API tourne sur un VPS, en Docker derrière Nginx et
Let's Encrypt. Voir [Déploiement](#déploiement) plus bas : un `git push` sur
`main` suffit.

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

## Après une modification

| Ce qui change | La commande |
|---|---|
| le code | `docker compose -f docker-compose.prod.yml up -d --build backend` |
| le `.env` | `docker compose -f docker-compose.prod.yml up -d --force-recreate backend` |
| rien (relancer un processus bloqué) | `restart` |

Dans les deux premiers cas, **`restart` ne suffit pas**, et c'est silencieux.

L'image embarque le code (`COPY . .`) : un `restart` relance l'ancienne image
sans le moindre avertissement.

Les variables d'environnement, elles, sont fixées à la **création** du
conteneur. `restart` relance le même conteneur avec l'environnement qu'il
portait déjà : une clé d'API corrigée dans le `.env` reste donc ignorée, et
l'erreur affichée est celle de l'ancienne valeur. Le symptôme est déroutant —
un `curl` depuis l'hôte réussit avec la nouvelle clé pendant que
l'application continue d'être refusée.

## Déploiement

L'API tourne sur un VPS : PostgreSQL et le backend en Docker, Nginx devant en
reverse proxy, certificat Let's Encrypt renouvelé par Certbot.

Pousser sur `main` suffit. [`deploy.yml`](.github/workflows/deploy.yml) lance
la suite de tests et vérifie que l'image se construit ; le déploiement ne
démarre que si les deux passent. Il se connecte ensuite en SSH, met le dépôt à
jour, reconstruit le conteneur, attend qu'il soit `healthy`, et vérifie que
`/health` porte bien la révision qui vient d'être poussée — puis que l'API
publique répond.

Secrets à configurer une fois dans ce dépôt (Settings → Secrets and variables
→ Actions) :

| Secret | Valeur |
|---|---|
| `VPS_HOST` | adresse du serveur |
| `VPS_USER` | utilisateur SSH |
| `VPS_SSH_KEY` | clé privée SSH, la publique étant dans `~/.ssh/authorized_keys` du serveur |

[`security.yml`](.github/workflows/security.yml) complète avec `npm audit` et
un scan de secrets commités, à chaque poussée et chaque pull request.

### Première installation

```bash
mkdir -p /var/www/saambiz-backend
git clone <url> /var/www/saambiz-backend
cd /var/www/saambiz-backend
cp .env.example .env     # puis remplir, et chmod 600
docker compose -f docker-compose.prod.yml up -d --build
```

`HOST_PORT` du `.env` fixe le port publié sur l'hôte (3000 par défaut) : à
changer si une autre application l'occupe déjà, en alignant l'`upstream` de
[`deploy/nginx.conf`](deploy/nginx.conf) sur la même valeur.

Nginx se pose en deux temps, parce que `deploy/nginx.conf` référence des
certificats qui n'existent pas encore : un bloc HTTP minimal, puis
`certbot --nginx -d <domaine>`, puis le fichier complet. `nginx -t` avant
chaque `reload`, sans exception — un seul fichier invalide empêche de
recharger **tous** les sites de la machine, et bloque aussi le renouvellement
des certificats.

### Mise à jour manuelle

```bash
bash deploy/deploy.sh --mode docker
```

### Sauvegardes

```bash
bash deploy/backup-postgres.sh
```

À planifier par cron (voir [`deploy/backup-postgres.sh`](deploy/backup-postgres.sh)).
Une sauvegarde jamais restaurée n'est qu'une hypothèse : testez-la une fois
dans une base dédiée.

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
