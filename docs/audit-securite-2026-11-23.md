# Audit de sécurité — SaamBiz (API + back-office KODAFRIK)

**Date** : 23 novembre 2026
**Périmètre** : `Saambiz_Back` (API, commit local `d0231d2`) + `kodafrik-admin`, application `apps/saambiz` (commit `ed10e06`)
**Références** : OWASP ASVS 5.0.0, OWASP Top 10 2021, OWASP API Security Top 10 2023
**Méthode** : lecture de code intégrale des surfaces exposées, exécution de la suite de tests du dépôt, `npm audit`, analyse de l'historique Git. **Aucun test sur l'infrastructure de production.**

**Annexe** : [`annexe-inventaire-endpoints.md`](annexe-inventaire-endpoints.md) — les **227 endpoints**, chacun avec l'état de ses cinq contrôles (authentification, rôle/permission, tenant, propriété de la ressource, validation) et son consommateur. Table engendrée par outillage, pas recopiée.

---

## 0. Périmètre des modifications — admin seulement

Consigne de l'utilisateur, dans ses mots : « **évite de toucher les API du mobile qui
sont déjà bonnes, toutes les modifs concernent l'admin** ». Elle découpe les 227
routes en deux ensembles, et ce découpage n'est pas une estimation : il se recoupe
avec les contrats de routes engendrés par le dépôt lui-même.

| Consommateur | Routes | Ce que je fais |
|---|---|---|
| **ADMIN** (`/admin/*`, `/admin/rbac/*`) | **84** | Je peux corriger |
| MOBILE (applications Flutter en production sur les stores) | 135 | **Je documente, je ne touche pas au contrat** |
| VITRINE (site public d'une boutique) | 6 | Je documente |
| WEBHOOK (Orange Money, Wave) | 2 | Je documente |

Trois conséquences que j'applique sans exception :

1. **Une faille sur une route mobile ne devient pas acceptable parce qu'elle est
   sur une route mobile.** Les défauts du périmètre mobile sont en **section 9**,
   classés par gravité, avec le correctif que je recommande — à toi de décider.
2. **Si un correctif côté admin oblige à toucher du code partagé** (un middleware,
   un schéma, un service commun aux deux surfaces), **je m'arrête et je te
   demande**. C'est exactement le cas où l'on casse une application publiée sans
   le voir.
3. Quand un endpoint sert les deux, l'annexe le dit plutôt que de le deviner.

---

## 1. Résumé exécutif

### Niveau de sécurité observé

**Bon à très bon.** Ce n'est pas une formule de politesse : l'API porte des protections
que l'on ne trouve pas dans la majorité des projets de cette taille, et elles sont
appliquées **au bon endroit** — côté serveur, à la source des requêtes, pas en
surface.

Trois choses, en particulier, sont faites correctement et méritent d'être nommées
avant les défauts :

1. **L'isolation entre boutiques est structurelle, pas défensive.** Chaque accès par
   identifiant est borné dans la clause `where` elle-même
   (`where: { id: produitId, vendeurId }`), et non vérifié après chargement. La
   différence est capitale : un filtre posé à la source ne peut pas être oublié par
   une branche de code, là où une vérification après coup se contourne dès qu'un
   nouveau chemin d'appel apparaît.
2. **Le RBAC est vérifié côté serveur sur chacune des 84 routes d'administration**,
   en modèle strict (aucune ligne de permission = aucun accès), et il **refuse**
   quand sa propre vérification échoue au lieu de laisser passer.
3. **La connexion égalise son temps de réponse** avec un hash factice, ce qui ferme
   l'énumération par chronométrage — une finesse rare.

### Vulnérabilités critiques

**Aucune.** Je n'ai trouvé ni compromission totale, ni prise de contrôle
d'administration, ni accès multi-boutiques.

### Une vulnérabilité HIGH — **corrigée** : le rejet de produit ne retirait rien

> **Statut au 23 novembre, après arbitrage de l'utilisateur : CORRIGÉE EN ENTIER.**
> Le filtre de visibilité est centralisé dans `acheteurs.service.js`
> (`PRODUIT_VISIBLE`, une constante gelée, douze usages), la création de
> commande refuse un produit retiré, et le retour de stock ne défait plus une
> décision de modération. 22 tests, dont **14 échouent sans les correctifs**.
> Détail en **section 4.1**. Ce qui suit décrit le défaut tel qu'il était.

C'est le défaut le plus important de cet audit, et il touche directement une action
de ton back-office.

`PUT /admin/produit/:id/rejeter` écrit `statut: 'rejete'`
(`admin.service.js:397`) et **ne touche pas à `disponible`**. Or sur toute la
surface héritée `/acheteurs/*` — **12 méthodes de `acheteurs.service.js`, aucune
exception** — le filtre de visibilité ne regarde jamais `statut`. Le produit rejeté
reste donc listé, cherchable, consultable par son identifiant, et **commandable** :
`commande.service.js:298` contrôle `produit.disponible` mais pas `produit.statut`.

Pendant ce temps, la notification envoyée au vendeur affirme qu'il
« n'est plus proposé aux clients » (`admin.service.js:404`). L'administrateur croit
avoir retiré le produit, le vendeur croit qu'il est retiré, et il est en vente.

Ce n'est **pas** une fuite inter-boutiques et pas un contournement
d'authentification. C'est le contournement d'un **contrôle d'administration** : une
décision de modération sans effet. Pour une place de marché, un produit
contrefait, illicite ou frauduleux que tu as retiré reste en vente — d'où le
classement HIGH. Détail et correctif : **H-01** (section 2) et **section 9**, car
le correctif est dans un service du périmètre mobile.

### Risques de fuite inter-boutiques

**Aucun trouvé sur les routes testées.** Voir la section 5 pour le détail des
mécanismes et la liste exacte de ce qui a été vérifié — et de ce qui ne l'a pas été.

### Risques de prise de contrôle administrateur

**Aucun chemin d'escalade trouvé** depuis un compte vendeur ou client. Les routes
d'administration exigent `role === 'Admin'` **et** une permission fine par menu et
par action. Un vendeur muni d'un jeton valide reçoit un 403 sur `/admin/*`.

La seule élévation possible part d'un compte qui détient déjà la permission
`ADMINS/update` : il peut s'attribuer tous les droits. C'est inhérent au modèle
(qui administre les administrateurs est de fait super-administrateur), et l'action
est journalisée. Ce n'est pas un défaut, c'est une propriété à connaître :
**la permission `ADMINS/update` équivaut à un accès total.**

### Corrections effectuées

**Sept correctifs appliqués. 122 tests de sécurité ajoutés et exécutés.**

Les sept sont ceux qui ne peuvent pas casser une application mobile publiée :
deux au périmètre admin (le rejet de produit qui retire enfin de la vente, les
garde-fous sur la suppression d'administrateur), et cinq dont le changement de
comportement ne concerne que des cas qu'aucun client n'émet — algorithme JWT
épinglé en un seul endroit, tri qui ne traverse plus la chaîne des prototypes,
ordre des contrôles dans `authOptionnel`, référence de commande tirée par
`crypto`, corps brut des webhooks conservé aux deux adresses. Détail et limites
en **section 4.1** : notamment **H-01 est atténué, pas corrigé** — la vente est
bloquée, mais le produit rejeté reste consultable sur 7 des 12 routes
`/acheteurs/*`.

**Suite complète : `68 suites, 1343 tests, tous verts`. Aucune régression.**
Rien n'est committé ni poussé.

Avant ces correctifs, l'étape qui comptait le plus :

C'est l'ordre que l'utilisateur a choisi, et c'est le bon : les tests sont des
fichiers neufs, ils ne collisionnaient avec rien, et ils transforment cet audit
en preuves avant qu'une seule ligne de code ne bouge. Le détail est en
section 7 ; en résumé :

- **96 tests passent** et retiennent des protections qui ne tenaient jusque-là
  qu'à la discipline d'écriture — au premier rang l'isolation entre boutiques,
  qu'**aucun** des 1 214 tests précédents n'exerçait ;
- **12 tests marqués `it.failing`** démontrent les défauts : H-01, M-01, L-01,
  L-05, L-06, L-07. Chacun a été repassé en `test` et exécuté pour vérifier
  qu'il échoue **pour la bonne raison** — l'un ne le faisait pas, c'est dit et
  corrigé ;
- **suite complète : 67 suites, 1 329 tests, aucune régression.**

J'ai conduit l'analyse **en lecture seule**, pour deux raisons :

- une autre session a du travail **non committé** dans les deux dépôts du périmètre
  (29 fichiers modifiés et 11 nouveaux dans `kodafrik-admin/apps/saambiz`,
  `src/utils/formatUser.js` + son test dans `Saambiz_Back`) ; écrire là-dessus
  mélangerait son travail au mien ;
- aucun des défauts trouvés ne justifie une correction en urgence sans ton accord.

Les correctifs sont décrits, chiffrés et prêts (section 4). Chacun vient avec le
test qui doit échouer sans lui.

### Risques restant ouverts — les trois qui comptent

| | Risque | Qui agit |
|---|---|---|
| 1 | **Aucune sauvegarde automatique n'est configurée** par les scripts de déploiement. Si le VPS est perdu, la base est perdue. | **Toi** (section 8) |
| 2 | **La vérification d'adresse email n'est jamais exigée** : un compte non vérifié accède à toute l'API. | **Toi** (décision produit) |
| 3 | **Le délai de grâce de 10 min sur les jetons de rafraîchissement** permet à un jeton volé de reprendre la session en coupant l'utilisateur légitime. | Correctif possible, arbitrage à faire |

---

## 2. Tableau des vulnérabilités

Classification : **CRITICAL** (compromission totale, accès multi-boutiques, prise de
contrôle admin, fuite massive) · **HIGH** (accès non autorisé à des ressources
sensibles, escalade, compromission de compte) · **MEDIUM** (exploitation
conditionnelle ou impact modéré) · **LOW** (faiblesse de configuration) ·
**INFORMATIONAL**.

« Exploitabilité » dit ce qu'il faut réunir pour y arriver, pas une note abstraite.

### CRITICAL — néant

### HIGH

| ID | Vulnérabilité | Fichier / endpoint | Exploitabilité | Impact | Correction proposée |
|---|---|---|---|---|---|
| **H-01** | **Le rejet d'un produit par la modération est sans effet.** `rejeterProduit` écrit `statut: 'rejete'` et laisse `disponible` tel quel (`admin.service.js:394-409`). Aucune des **12 méthodes de `acheteurs.service.js` qui manipulent `Produit`** ne filtre sur `statut: 'approuve'` — mesuré une par une : `listerTousProduits` (l.33), `rechercherProduits` (l.75), `filtrerParVille` (l.131), `contacterVendeurWhatsapp` (l.190), `getProduitsByBoutique` (l.322), `getDetailProduit` (l.389), `getDetailBoutique` (l.415), `listerProduitsAvecFiltres` (l.438), `produitsTendance` (l.485), `decouverte` (l.509), `promotionsActives` (l.579), `rechercheGlobale` (l.610). Et la commande n'en tient pas compte non plus : `commande.service.js:298` teste `produit.disponible`, jamais `produit.statut`. **Par contraste, les surfaces récentes filtrent toutes correctement** : `catalogue.service.js:180, 241, 350, 362`, `vitrine.service.js:302`, `categorie.service.js:69`, `accueil.service.js:633`. Le défaut est donc circonscrit au service hérité. | `src/services/admin/admin.service.js:397`<br>`src/services/acheteurs/acheteurs.service.js` (12 méthodes)<br>`src/services/commandes/commande.service.js:298`<br>**~10 endpoints `/acheteurs/*` + la création de commande** | **Aucune attaque n'est nécessaire.** Le comportement par défaut suffit : le produit par défaut est `statut: 'approuve'` (`produit.model.js:64`), donc la modération est réactive et `rejete` n'a d'autre rôle que de retirer. | Un produit **contrefait, illicite ou frauduleux retiré par un administrateur reste en vente** via l'application mobile. Le vendeur reçoit pourtant « n'est plus proposé aux clients » (`admin.service.js:404`) : personne ne s'en aperçoit. Pas une fuite inter-boutiques. | Deux voies. **(a)** `rejeterProduit` écrit aussi `disponible: false` — une ligne, effet immédiat, mais le vendeur peut le remettre à `true`. **(b)** Centraliser un filtre de visibilité (`statut: 'approuve'`) dans `acheteurs.service.js` et ajouter le contrôle dans `commande.service.js` — la vraie correction à la source. **(b) touche un service du périmètre mobile : je ne l'applique pas sans ton accord** (section 9). |

### MEDIUM

| ID | Vulnérabilité | Fichier / endpoint | Exploitabilité | Impact | Correction proposée |
|---|---|---|---|---|---|
| **M-01** | **Énumération de comptes à la connexion.** L'état du compte est révélé **avant** toute vérification du mot de passe : « Ce compte a été supprimé. » ou « Votre compte est inactif » distinguent un compte existant d'un compte inconnu. Le cas `statut !== 'actif'` n'appelle même pas `bcrypt`, donc l'écart est aussi chronométrique. | `src/services/auth.service.js:338-345`<br>`POST /saambiz/v1/auth/login` | **Facile.** Une requête, aucun compte requis. Plafonné à 10 essais/15 min par couple IP+identifiant, mais les échecs sur un compte *suspendu* ne coûtent rien à l'attaquant. | Constitution d'une liste d'adresses et de numéros inscrits — matière première du hameçonnage et du bourrage d'identifiants. Pas d'accès aux données. | Déplacer les deux contrôles **après** `bcrypt.compare`. L'utilisateur légitime garde son message précis ; un mot de passe faux ne renvoie plus que le message générique. |
| **M-02** | **Aucune sauvegarde automatique.** `setup-server.sh` **affiche** la ligne de cron en la qualifiant d'« optionnel » au lieu de l'installer. Si elle a été posée à la main : sauvegardes **non chiffrées**, **sur la même machine que la base**, **aucune copie hors site**, **restauration jamais testée**. `deploy.sh` ne prend aucune sauvegarde avant de déployer. | `deploy/setup-server.sh:112-114`<br>`deploy/backup-postgres.sh`<br>`deploy/deploy.sh` | Aucune attaque nécessaire : une panne de disque, une erreur de migration ou un `DROP` malheureux suffit. | **Perte totale et définitive** des comptes, boutiques, produits, commandes et paiements. Le risque le plus coûteux de tout cet audit. | Installer le cron ; chiffrer le dump ; le copier hors du VPS ; **tester une restauration**. Détail en section 8 — c'est ton action. |
| **M-03** | **Dépendance de production vulnérable.** `zod < 4.6.6` — épuisement mémoire sur des collections contraintes surdimensionnées (GHSA-mrhx-c7xc-m3w5, *high*). Arrive par `jimp`, utilisé pour l'analyse de logo. 29 alertes *high* au total, toutes issues de cette racine. | `package-lock.json`<br>`src/services/vitrine/logo.analyse.service.js:16`<br>`POST /saambiz/v1/vendeur/vitrine/analyser-logo` | **Difficile.** La route exige un vendeur authentifié, et l'entrée attaquable est un tampon d'image, pas une collection validée par `zod`. Je n'ai pas trouvé de chemin d'exploitation réel. | Déni de service sur le processus Node si un chemin existe. | `npm audit fix` (annoncé sans rupture). À faire et à vérifier par un déploiement de recette, pas à chaud. |
| **M-04** | **Vérification de signature fragile sur le webhook Orange.** Le corps brut n'est collecté que sur l'adresse *historique* : `app.use('/saambiz/paiement/webhook/orange', …)`. Or le routeur est monté **aux deux** adresses. Sur `/saambiz/v1/paiement/webhook/orange` — l'adresse de référence — `req.rawBody` est absent et le code retombe sur `JSON.stringify(req.body)`, une **ré-sérialisation**. | `src/app.js:117-122` vs `src/app.js:240`<br>`src/services/paiement/orangeMoney.service.js:121` | Pas d'exploitation : l'attaquant ne peut pas forger le HMAC. Le défaut est **fermé par défaut**. | Une notification légitime d'Orange dont les octets ne sont pas du JSON compact est **rejetée** sur l'adresse de référence : paiement encaissé côté opérateur, non confirmé côté SaamBiz. Latent tant que `PAIEMENT_EN_LIGNE_ACTIF=false`. | Aligner sur Wave : collecter le corps brut dans le `verify` de `express.json` avec un test sur `req.originalUrl.includes('/paiement/webhook/orange')`, ce qui couvre les deux adresses. |
| **M-05** | **La vérification d'adresse email n'est jamais exigée.** La colonne `verifie` est écrite à l'inscription et à la connexion sociale, mais **aucun middleware ni service ne la contrôle**. Un compte dont l'adresse n'a jamais été confirmée se connecte et utilise toute l'API. | `src/models/utilisateur.model.js:63`<br>aucun appelant dans `src/middlewares/` | **Facile.** S'inscrire avec l'adresse d'un tiers et ignorer le code. | Un compte peut détenir l'adresse de quelqu'un d'autre : la victime ne peut plus s'inscrire, et reçoit les emails de commande. L'adresse de récupération du mot de passe n'est jamais prouvée. | **Décision produit, pas correctif technique.** Exiger `verifie` casserait la connexion de tous les comptes déjà non vérifiés en production. Voir section 8. |
| **M-06** | **Le délai de grâce transforme un vol de jeton en prise de session.** Un jeton de rafraîchissement déjà tourné reste présentable pendant 10 min : `faireTourner` **révoque alors le remplaçant** (celui que détient l'utilisateur légitime) et en émet un neuf pour l'appelant. Le voleur prend donc la place, et l'utilisateur est déconnecté. Aucune révocation de lignée, aucune alerte — un simple `logger.info`. | `src/services/refreshToken.service.js:134-149`<br>`POST /saambiz/v1/auth/refresh` | **Conditionnelle** : il faut d'abord voler un jeton de rafraîchissement (`sessionStorage` du back-office, stockage de l'application mobile), puis le présenter dans les 10 min suivant une rotation. | Prise de session complète dans le rôle de la victime. ASVS 3.x demande à l'inverse de **révoquer toute la lignée** dès qu'un jeton tourné est réutilisé. | Arbitrage : le délai de grâce existe pour un cas réel (remplaçant perdu en chemin). Piste sûre — le conserver mais **journaliser en `warn`** et compter les usages ; au deuxième usage du même jeton tourné, révoquer la lignée entière. |

### LOW

| ID | Vulnérabilité | Fichier / endpoint | Exploitabilité | Impact | Correction proposée |
|---|---|---|---|---|---|
| **L-01** | `jwt.verify` appelé **sans** `algorithms`, `issuer` ni `audience`. | `src/middlewares/auth.middleware.js:29`<br>`src/middlewares/authOptionnel.middleware.js:28`<br>`src/services/socket.service.js:33` | Aucune voie trouvée : `jsonwebtoken` 9 refuse `alg: none`, et les trois secrets (accès, rafraîchissement, réinitialisation) sont **distincts et vérifiés distincts au démarrage**, ce qui ferme la confusion de types de jeton. | Défense en profondeur manquante. | Épingler `{ algorithms: ['HS256'] }` dans les trois appels. |
| **L-02** | CORS accepte **tout** sous-domaine de `saambiz.com` et de `kodafrik.com`, avec `credentials: true`. | `src/config/security.js:301, 317` | Requiert la prise de contrôle d'un sous-domaine (DNS pendant, hébergement tiers). Les expressions sont correctement ancrées : `evil-saambiz.com` est refusé. | Un sous-domaine pris ouvre l'API avec les informations d'identification du navigateur. | Compromis assumé et documenté (deux pannes de production l'ont motivé). À resserrer sur une liste explicite quand `CORS_ORIGIN` sera fiable sur l'hébergeur. |
| **L-03** | `deviceToken.route.js` est le **seul** routeur authentifié sans `checkActiveUser`. | `src/routes/deviceToken.route.js:6` | Un compte suspendu ou supprimé, avec un jeton d'accès encore valide (≤ 1 h), enregistre ou retire ses jetons d'appareil. | Très faible. | Ajouter `router.use(checkActiveUser)`. Une ligne. |
| **L-04** | Référence de commande dérivée de `Math.random()` : `CMD-<année>-<6 caractères base36>`. | `src/services/commandes/commande.service.js:79` | `Math.random` n'est pas cryptographique et son état est reconstituable. Mais la référence n'est que le **premier** facteur du suivi public : le téléphone doit aussi correspondre, et le plafond est de 40 essais/10 min. | Faible seul. Deviendrait sérieux si la référence servait un jour d'unique facteur. | `crypto.randomBytes` plutôt que `Math.random` — même format, même longueur, aucun changement visible. |
| **L-05** | **Recherche de tri sur la chaîne de prototypes.** `ORDRES[tri] \|\| ORDRES.pertinence` : pour `tri=constructor`, `ORDRES['constructor']` vaut la fonction `Object`, donc **vrai**, et le repli ne joue pas. `Object` part alors comme clause `order` vers Sequelize. Vérifié : `ORDRES['constructor']` et `ORDRES['__proto__']` sont tous deux vrais. | `src/services/vitrine/vitrine.service.js:503`<br>`src/services/catalogue/catalogue.service.js:223`<br>`GET /vitrine/:slug/produits?tri=constructor`<br>`GET /catalogue/produits?tri=constructor` | **Facile, sans compte.** Routes publiques. | **Non confirmé** : je n'ai pas exécuté la requête (pas de PostgreSQL ici). Attendu : erreur 500. Aucune injection SQL — la valeur n'est pas concaténée. | `Object.hasOwn(ORDRES, tri) ? ORDRES[tri] : ORDRES.pertinence`, aux deux endroits. |
| **L-06** | `updatePermissions` ne vérifie pas que la cible est un administrateur ; rien n'empêche un admin de se supprimer lui-même ni de supprimer le dernier administrateur. | `src/services/admin.management.service.js:99, 121` | Requiert `ADMINS/delete` ou `ADMINS/update`. | Lignes de permission inertes sur un non-admin (sans effet : `isAdmin` filtre en amont). Verrouillage total du back-office si le dernier admin disparaît. | Refuser la suppression de soi-même et du dernier administrateur ; exiger `role === 'Admin'` sur la cible de `updatePermissions`. |
| **L-07** | `authOptionnel` consulte la liste noire **avant** de vérifier la signature — l'ordre inverse de `auth.middleware`, qui documente précisément pourquoi la signature passe d'abord. | `src/middlewares/authOptionnel.middleware.js:25-28` | Envoyer des jetons fabriqués en rafale sur une route publique. | Une requête PostgreSQL inutile par jeton bidon. Plafonné par le limiteur global. | Permuter les deux blocs, comme dans `auth.middleware.js:28-33`. |
| **L-08** | CI déclenchée sur `pull_request` et `workflow_dispatch` **seulement** : un `push` direct sur `main` n'est jamais vérifié. Aucun bloc `permissions:`. Aucun `npm audit`, aucun passage sécurité. | `.github/workflows/ci.yml:12-14` | — | Du code non vérifié peut atteindre `main`, et de là la production. Le jeton du workflow hérite des droits par défaut du dépôt. | Ajouter `push: branches: [main]`, `permissions: contents: read`, une étape `npm audit --omit=dev --audit-level=high`, et le passage de tests de sécurité. |
| **L-09** | Durcissement de conteneur incomplet : pas de `cap_drop`, pas de `read_only`. En-tête `Permissions-Policy` absent. | `docker-compose.prod.yml:49-123`<br>`deploy/nginx-entetes.conf` | — | Surface résiduelle en cas d'exécution de code dans le conteneur. | `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`. **À ne pas appliquer sans recette** : touche au déploiement. |
| **L-10** | `ROLES_TOUT_ACCES = ['SuperAdmin']` désigne un rôle **absent** de l'ENUM `('Admin','Acheteur','Vendeur')`. Le court-circuit est donc inatteignable. | `src/middlewares/requirePermission.middleware.js:23`<br>`src/models/utilisateur.model.js:43` | — | **Aucun aujourd'hui**, et le sens de la panne est le bon (refus, pas passage). Mais le jour où `'SuperAdmin'` est ajouté à l'ENUM, un contournement complet du RBAC s'ouvre sans que personne n'ait touché au RBAC. | Soit retirer le code mort, soit ajouter le rôle **et** un test qui fixe le comportement attendu. À décider, pas à trancher seul. |
| **L-11** | `application/pdf` est accepté sur **toutes** les routes d'upload, photos de produit comprises. | `src/config/security.js:359`<br>`src/middlewares/upload.middleware.js:58` | Un vendeur authentifié dépose un PDF comme photo de produit. | Affichage cassé, pas de XSS : les fichiers partent sur l'origine publique R2, séparée de l'origine applicative, et la CSP de nginx interdit `script-src` externe. **`image/svg+xml` est absent de la liste blanche** — le vecteur classique est donc déjà fermé. | Restreindre le PDF à la seule route qui en a besoin (pièce d'identité) et n'accepter que JPEG/PNG ailleurs. |

### INFORMATIONAL

| ID | Observation | Référence | Pourquoi ce n'est pas un défaut |
|---|---|---|---|
| **I-01** | Jetons de rafraîchissement valides 10 ans. | `src/config/security.js:66` | Décision assumée et documentée : la session se ferme sur un geste, pas sur le temps. La borne réelle est l'**inactivité de 3 h**, glissante, plus protectrice qu'une expiration longue. |
| **I-02** | `DeviceToken.upsert(…, { conflictFields: ['token'] })` : le dernier compte qui enregistre un jeton d'appareil le possède. | `src/services/push.service.js:365` | C'est le comportement **correct** pour un téléphone qui change de compte. Risque résiduel nommé : qui connaît le jeton FCM d'une victime détourne ses notifications. Obtenir ce jeton n'est pas trivial, et les journaux n'en gardent qu'une empreinte. |
| **I-03** | CSP Helmet de l'API avec `scriptSrc: 'unsafe-inline'`. | `src/app.js:68` | Nécessaire à Swagger UI, lui-même **désactivé en production** (`src/app.js:157`). L'API ne sert aucune page HTML en production. |
| **I-04** | `GET /saambiz/v1/messages/:userId` laisse lire la conversation avec n'importe quel utilisateur. | `src/services/messagerie/message.service.js:80-95` | C'est **sa propre** conversation : la requête est bornée aux messages dont l'appelant est expéditeur ou destinataire. Pas une fuite. |

---

## 3. Tableau des contrôles

> **Réserve honnête sur ce tableau.** La liste verbatim des 110 contrôles numérotés ne
> m'a pas été transmise — le brief en reprenait la substance par domaine. Les
> numéros ci-dessous sont donc **ma propre numérotation**, dérivée des domaines du
> brief, et ne correspondent pas forcément à la tienne. Donne-moi la liste exacte et
> je renumérote sans rien réécrire d'autre.
>
> Règle appliquée sans exception : **aucun PASS sans preuve** — un extrait précis
> `fichier:ligne`, ou un test réellement exécuté. Tout le reste est NOT TESTED et
> le dit.

### A. Isolation multi-boutiques (priorité 1)

| N° | Contrôle | État | Preuve | Correction | Test |
|---|---|---|---|---|---|
| A-01 | Le tenant est déduit du contexte d'identité serveur, jamais d'un paramètre client | **PASS** | `req.user` est posé par `auth.middleware.js:38-44` depuis `decoded.id` du jeton signé ; aucun contrôleur ne lit de `vendeurId`/`tenantId` dans le corps ou l'URL (recherche exhaustive) | — | À ajouter (T-01) |
| A-02 | Produits : lecture bornée au vendeur | **PASS** | `vendeur.service.js:1177` `const where = { vendeurId }` | — | À ajouter (T-01) |
| A-03 | Produits : modification bornée au vendeur | **PASS** | `vendeur.service.js:146-151` `findOne({ where: { id: produitId, vendeurId } })` puis `NotFoundError` | — | À ajouter (T-01) |
| A-04 | Produits : suppression bornée au vendeur | **PASS** | `vendeur.service.js:186-187` | — | À ajouter (T-01) |
| A-05 | Produits : disponibilité et duplication bornées | **PASS** | `vendeur.service.js:1126, 1153` | — | À ajouter (T-01) |
| A-06 | Images de produit : ajout et suppression bornés | **PASS** | `vendeur.service.js:1262, 1289-1292` — le produit est vérifié **avant** l'image, et l'image est bornée à `produitId` | — | À ajouter (T-01) |
| A-07 | Photos de vitrine : suppression et réordonnancement bornés | **PASS** | `vendeur.service.js:735-759` via `_modifierPhotosVitrine(vendeurId, …)` | — | NOT TESTED |
| A-08 | Abonnés de la boutique : détail borné | **PASS** | `vendeur.service.js:610-619` — boutique du vendeur résolue d'abord, puis `Favori` borné à `boutiqueId` | — | NOT TESTED |
| A-09 | Commande : détail réservé à l'acheteur ou au vendeur concerné | **PASS** | `commande.service.js:664-668` `if (commande.acheteurId !== userId && commande.vendeurId !== userId)` | — | À ajouter (T-02) |
| A-10 | Commande : changement de statut borné au vendeur concerné | **PASS** | `commande.service.js:705` | — | À ajouter (T-02) |
| A-11 | Commande : confirmation de paiement bornée au vendeur concerné | **PASS** | `commande.service.js:786` | — | À ajouter (T-02) |
| A-12 | Commande : annulation bornée à l'acheteur concerné | **PASS** | `commande.service.js:899, 938` | — | À ajouter (T-02) |
| A-13 | Commande : réponse à l'annulation bornée au vendeur concerné | **PASS** | `commande.service.js:982` | — | À ajouter (T-02) |
| A-14 | Une commande ne peut pas mélanger deux boutiques | **PASS** | `commande.service.js:306-308` — le `vendeurId` est fixé par le premier produit et toute divergence est rejetée | — | Couvert par `commandeBoutiqueVendeur.test.js` |
| A-15 | Un vendeur ne saisit que ses propres produits (commande au comptoir) | **PASS** | `commande.controller.js:141-145` — `Produit.count({ id: IN ids, vendeurId })` comparé au nombre d'identifiants distincts | — | NOT TESTED |
| A-16 | Paiements : consultation bornée au propriétaire | **PASS** | `paiement.controller.js:141-143` — vérification **après** chargement, mais présente | Renforcement possible : borner dans la requête | NOT TESTED |
| A-17 | Paiements : historique borné | **PASS** | `paiement.service.js:277` `where: { utilisateurId }` | — | NOT TESTED |
| A-18 | Messagerie : conversation bornée aux deux participants | **PASS** | `message.service.js:82-87` — `Op.or` sur les deux sens, toujours avec l'appelant | — | NOT TESTED |
| A-19 | Messagerie : marquer lu borné au destinataire | **PASS** | `message.service.js:168` `findOne({ where: { id: messageId, destinataireId } })` | — | NOT TESTED |
| A-20 | Messages du site : liste, lecture, suppression bornées au vendeur | **PASS** | `message.service.js:190, 202, 209` — et validation du format UUID avant requête | — | Couvert par `messageSite.test.js` |
| A-21 | Notifications : liste et marquage bornés | **PASS** | `notification.service.js:95, 104, 111, 116` | — | NOT TESTED |
| A-22 | Promotions : propriété du produit vérifiée | **PASS** | Couvert par `promotionProprieteProduit.test.js` (exécuté, vert) | — | Déjà testé |
| A-23 | Avis : suppression bornée à son auteur | **PASS** | `avis.service.js:101-102` `destroy({ where: { acheteurId, boutiqueId } })` | — | NOT TESTED |
| A-24 | Requêtes ORM bornées au tenant, jointures comprises | **PASS** | `vendeur.service.js:882-884, 982-989, 991-1010` — requêtes brutes paramétrées par `replacements: { vendeurId }` | — | NOT TESTED |
| A-25 | Statistiques et KPI vendeur ne mélangent pas les boutiques | **PASS** | `vendeur.service.js:979-1010, 1050-1061` — `vendeurId` dans chaque agrégat | — | **NOT TESTED — à couvrir (T-03)** |
| A-26 | Recherche vendeur bornée | **PASS** | `vendeur.service.js:1177-1180` — `where` initialisé à `{ vendeurId }` avant tout filtre | — | À ajouter (T-01) |
| A-27 | Tri dynamique sans injection | **PASS** | `vitrine.service.js:491-503`, `catalogue.service.js:43-223` — correspondance par table, aucune concaténation | Voir **L-05** pour le repli sur le prototype | NOT TESTED |
| A-28 | Pagination bornée (pas de fuite par `limit`) | **PASS** | `message.service.js:187` `Math.min(Math.max(…,1),100)` ; couvert par `taillePage.test.js` | — | Déjà testé |
| A-29 | Clés de cache portant le contexte tenant | **NOT APPLICABLE** | Aucun cache applicatif : ni Redis, ni `node-cache`, ni mémoïsation de réponse (recherche exhaustive). La seule mise en cache est HTTP, sur les actifs statifs d'emails (`app.js:90-96`), sans donnée de compte | — | — |
| A-30 | Exports CSV / Excel / PDF isolés par tenant | **NOT APPLICABLE** | Aucune route d'export côté API : pas de génération CSV, Excel ou PDF dans `src/` | Si un export est ajouté : borner **et** se protéger de l'injection de formules CSV | — |
| A-31 | Opérations en masse bornées | **PASS** | `vendeur.service.js:1140, 1147` — `Produit.update({…}, { where: { vendeurId } })` | — | NOT TESTED |
| A-32 | Jobs programmés : contexte tenant conservé et revérifié | **PARTIAL** | 4 tâches (`jobs/index.js:10, 20, 30, 40`) : expiration d'abonnements, promotions, purge de jetons, nettoyage de liste noire. Elles opèrent **par nature** sur l'ensemble des comptes — c'est leur rôle, pas une fuite. Mais aucune ne reçoit ni ne revérifie de contexte tenant | Rien à corriger ; le modèle est « tâche système », pas « tâche tenant » | **NOT TESTED** |
| A-33 | WebSockets : contexte d'identité vérifié | **PASS** | `socket.service.js:26-35` — jeton exigé au handshake, signature vérifiée, liste noire consultée ; couvert par `socketRevocation.test.js` | Voir **L-01** (algorithme non épinglé) | Déjà testé |
| A-34 | Notifications et emails adressés au bon compte | **PASS** | `commande.service.js:1189, 1234` — destinataire pris sur la commande (`vendeurId`, `acheteurId`), jamais sur l'appelant | — | Couvert par `notificationsBoutique.test.js` |
| A-35 | Relations croisées non autorisées bloquées | **PASS** | `boutique.model.js` + `associationBoutiquesVendeur.test.js` (exécuté, vert) | — | Déjà testé |
| A-36 | Bascule de contexte / rôles multi-entreprises | **NOT APPLICABLE** | Le modèle est **un compte, un rôle, une boutique** : `role` est un ENUM simple sur `utilisateur`, et une boutique a un `vendeurId` unique. Il n'existe ni appartenance multiple, ni invitation, ni bascule de contexte — donc aucune de ces surfaces d'attaque | — | — |

### B. Authentification et comptes

| N° | Contrôle | État | Preuve | Correction | Test |
|---|---|---|---|---|---|
| B-01 | Hachage de mot de passe robuste | **PASS** | `security.js:109` bcrypt 12 tours ; couvert par `securite.test.js:176` | — | Déjà testé |
| B-02 | Politique de mot de passe | **PASS** | `security.js:111-116` — 8 caractères, majuscule, chiffre, caractère spécial | — | Couvert par `validation.test.js` |
| B-03 | Anti-force brute sur la connexion, par compte | **PASS** | `security.js:202-209` — 10/15 min par IP+identifiant, **échecs seuls** | — | Déjà testé (`securite.test.js`) |
| B-04 | Anti-bourrage d'identifiants, par IP | **PASS** | `security.js:214-221` — 50/15 min, échecs seuls | — | Déjà testé |
| B-05 | Plafond d'envoi de codes, compté sur l'adresse **visée** | **PASS** | `security.js:244-253` — c'est le bon axe : un attaquant qui change d'IP ne pilonne pas la boîte d'une victime | — | Déjà testé (`securite.test.js:152`) |
| B-06 | Plafond de saisie de codes, budget séparé de l'envoi | **PASS** | `security.js:259-269` | — | Déjà testé |
| B-07 | Énumération de comptes fermée | **FAIL** | `auth.service.js:338-345` — voir **M-01** | Déplacer les contrôles d'état après `bcrypt.compare` | **À ajouter (T-04)** |
| B-08 | Énumération par chronométrage fermée | **PARTIAL** | `auth.service.js:328-341` — hash factice pour un compte inconnu **et** un compte supprimé. Mais `statut !== 'actif'` (ligne 343) répond **sans** `bcrypt` | Même correctif que **M-01** | **À ajouter (T-04)** |
| B-09 | Vérification d'email non contournable | **FAIL** | `verifie` n'est contrôlé par aucun middleware ni service — voir **M-05** | Décision produit | — |
| B-10 | Vérification d'email non rejouable | **PASS** | `auth.service.js:247, 283` — `if (utilisateur.verifie)` court-circuite un code déjà consommé | — | Couvert par `inscriptionEnvoiCode.test.js` |
| B-11 | Réinitialisation de mot de passe : secret dédié | **PASS** | `security.js:28-46, 69` — `JWT_RESET_SECRET` exigé en production et vérifié **distinct** des deux autres | — | Déjà testé (`securite.test.js:45, 50`) |
| B-12 | Réinitialisation : sessions fermées ensuite | **PASS** | `account.service.js:183-185` — `revoquerTout` + coupure des sockets | — | Couvert par `reinitialisationSessions.test.js` |
| B-13 | Changement de mot de passe : sessions fermées | **PASS** | `auth.service.js:600-602` | — | NOT TESTED |
| B-14 | Suppression de compte réellement effective | **PASS** | `account.service.js:226-247` — `statut: 'inactif'` (donc `checkActiveUser` refuse), `compteSupprime: true`, refresh détruits, jeton courant en liste noire, sockets coupés, action journalisée | — | NOT TESTED |
| B-15 | Email et numéro d'un compte supprimé non réutilisables | **PASS** | `inscription.service.js:73`, `auth.service.js:60, 94` | — | NOT TESTED |
| B-16 | MFA sur les comptes à haut privilège | **FAIL** | Aucun second facteur : ni TOTP, ni code par email à la connexion admin (recherche exhaustive). Le back-office KODAFRIK tient sur mot de passe seul | Recommandation, pas correctif unilatéral — voir section 8 | — |
| B-17 | Connexion sociale : jeton vérifié auprès du fournisseur | **PASS** | `connexionSociale.service.js` ; couvert par `connexionSociale.test.js` (exécuté, vert) | — | Déjà testé |
| B-18 | Comptes d'administration exclus de la connexion sociale | **PASS** | `auth.service.js:478` et commentaire `auth.service.js:372` | — | Déjà testé |
| B-19 | Mot de passe initial d'un admin non journalisé | **PASS** | `admin.management.service.js:19-20, 49-55` — généré, haché, envoyé par email, jamais écrit en journal | Un lien d'invitation serait meilleur qu'un mot de passe par email | NOT TESTED |
| B-20 | Changement d'email contrôlé | **PARTIAL** | `admin.management.service.js:74-80` vérifie l'unicité, mais **ne redemande pas de vérification** de la nouvelle adresse | Conséquence de **M-05** | — |

### C. Autorisations et RBAC

| N° | Contrôle | État | Preuve | Correction | Test |
|---|---|---|---|---|---|
| C-01 | Vérification serveur sur **chaque** route d'administration | **PASS** | **84 / 84.** Compté deux fois, par deux méthodes : `grep -cE "^router\.(get\|post\|put\|patch\|delete)\("` → 74 et `grep -c "requirePermission("` → 74 sur `admin.route.js` ; 10 et 10 sur `adminManagement.route.js` | — | **À ajouter (T-05)** : garde-fou qui échoue si une route admin naît sans permission |
| C-02 | RBAC centralisé | **PASS** | Un seul `requirePermission.middleware.js`, utilisé partout | — | Déjà testé (`permissions.test.js`) |
| C-03 | Modèle strict : aucune permission = aucun accès | **PASS** | `requirePermission.middleware.js:57-83` — aucune valeur par défaut permissive | — | Déjà testé |
| C-04 | La panne du contrôle refuse l'accès | **PASS** | `requirePermission.middleware.js:86-95` — 503, jamais `next()` | — | Déjà testé |
| C-05 | Routes admin protégées indépendamment des menus affichés | **PASS** | `requirePermission` interroge la table `Permission` côté serveur ; les menus envoyés au dashboard (`auth.service.js:493-506`) ne font que composer la navigation | — | Déjà testé |
| C-06 | Permissions par action **et** par ressource | **PASS** | `requirePermission.middleware.js:25-30` — `view`/`create`/`update`/`delete` sur chaque code de menu | — | Déjà testé |
| C-07 | Chaîne complète identité → compte actif → rôle → permission | **PASS** | `adminManagement.route.js:12-14`, `admin.route.js:16-18` | — | NOT TESTED |
| C-08 | Un vendeur n'atteint pas `/admin/*` | **PASS** | `isAdmin.middleware.js:8` — `role !== 'Admin'` → 403 | — | **À ajouter (T-06)** |
| C-09 | Un client n'atteint pas les routes vendeur | **PASS** | `isVendeur.middleware.js:7` | — | **À ajouter (T-06)** |
| C-10 | Mass assignment fermé — produits | **PASS** | `vendeur.service.js:42, 155-157` — liste blanche `PRODUIT_FIELDS` qui **exclut** `vendeurId` et `statut` | — | **À ajouter (T-07)** |
| C-11 | Mass assignment fermé — boutiques | **PASS** | `vendeur.service.js:45` — `BOUTIQUE_FIELDS` exclut `vendeurId` | — | **À ajouter (T-07)** |
| C-12 | Pas d'auto-promotion sans droit | **PASS** | Pour modifier des permissions il faut déjà `ADMINS/update` (`adminManagement.route.js:33`) | — | NOT TESTED |
| C-13 | Impossible de supprimer le dernier administrateur | **FAIL** | `admin.management.service.js:99-106` — aucun garde-fou — voir **L-06** | Refuser l'auto-suppression et la suppression du dernier admin | À ajouter |
| C-14 | `updatePermissions` cible bien un administrateur | **FAIL** | `admin.management.service.js:121-124` — aucun contrôle du rôle de la cible — voir **L-06** | Exiger `role === 'Admin'` | À ajouter |
| C-15 | Court-circuit de rôle maîtrisé | **PARTIAL** | `requirePermission.middleware.js:23` vise `'SuperAdmin'`, absent de l'ENUM (`utilisateur.model.js:43`) : inatteignable — voir **L-10** | À trancher | À ajouter |
| C-16 | Mass assignment fermé sur les **routes d'administration** | **PASS** | `admin.service.js:477` — `_identite({ prenom, nom, email, telephone, adresse })` est une liste blanche **par déstructuration** : `role`, `statut`, `verifie`, `compteSupprime` et `soldeDisponible` sont inatteignables depuis le corps de la requête. `PUT /admin/vendeur/:id` et `PUT /admin/acheteur/:id` passent bien `req.body` entier au service, mais le service le filtre. J'avais suspecté une escalade par ce chemin : **il n'y en a pas** | — | **À ajouter (T-20)** : `{"role":"Admin"}` envoyé à `PUT /admin/vendeur/:id` est ignoré |
| C-17 | Un administrateur ne peut pas être modifié ni supprimé par les routes « utilisateurs » | **PASS** | `admin.service.js:555` — `findOne({ where: { id, role } })` borne la cible au rôle de la route ; `admin.service.js:580` refuse explicitement la suppression d'un `Admin` ; `creerUtilisateur` n'accepte que `'Acheteur'` ou `'Vendeur'` (l.377) | — | **À ajouter (T-20)** |
| C-18 | Le montant facturé n'est jamais décidé par le client | **PASS** | `commande.service.js:317-322` — prix relu en base dans la transaction, prix soldé appliqué s'il est inférieur ; aucun montant n'est lu dans la requête | — | **À ajouter (T-21)** |

### D. Sécurité des APIs

| N° | Contrôle | État | Preuve | Correction | Test |
|---|---|---|---|---|---|
| D-01 | Authentification obligatoire sur les routes privées | **PASS** | `router.use(authMiddleware)` en tête de chaque routeur privé : `vendeur.route.js:10`, `admin.route.js:16`, `commande.route.js:21`, `account.route.js:30`, `favori.route.js:8`, `message.route.js:9`, `notification.route.js:7`, `paiement.route.js:18`, `acheteurs.route.js:18`, `deviceToken.route.js:6`, `adminManagement.route.js:12` | — | Couvert partiellement par `contratRoutesMobile.http.test.js` |
| D-02 | Routes publiques volontaires et documentées | **PASS** | `vitrine.route.js:13-23` (justification écrite), `catalogue.route.js:8` (`authOptionnel`), `configPublique.route.js`, `categorie.route.js`, `paiement.route.js:12-13` | — | Couvert par `configPublique.http.test.js` |
| D-03 | Injection SQL | **PASS** | **Recherche exhaustive automatisée** : 6 blocs de SQL brut contiennent une interpolation. 4 n'interpolent que `latitude`/`longitude`/`rayonKm`, **passés par `parseFloat` + `isNaN` + bornes** (`acheteurs.service.js:756-769`, `accueil.service.js:733-735, 765-767`) — la valeur insérée est donc toujours un nombre JavaScript. Les 2 autres interpolent des constantes SQL figées (`catalogue.service.js:27`, `vendeur.service.js:979`). Toutes les autres requêtes brutes utilisent `replacements` | — | **À ajouter (T-08)** |
| D-04 | Injection NoSQL | **NOT APPLICABLE** | PostgreSQL + Sequelize uniquement, aucune base documentaire | — | — |
| D-05 | Injection de commandes | **PASS** | Aucun `child_process`, `exec`, `execSync` ni `spawn` dans `src/` | — | NOT TESTED |
| D-06 | SSRF | **PARTIAL** | Les appels sortants (`axios`) visent des adresses d'opérateurs lues dans l'environnement, pas dans une requête utilisateur. Mais `logo.analyse.service.js` traite un fichier téléversé, pas une URL fournie — donc pas de SSRF par ce chemin | Rien à corriger en l'état | **NOT TESTED** |
| D-07 | Path traversal sur les uploads | **PASS** | `upload.middleware.js:39` `multer.memoryStorage()` — rien n'est écrit sur disque, et la clé de stockage est **générée** (`upload.service.js:119-127`), jamais dérivée du nom de fichier client | — | Couvert par `nommageFichiers.test.js` |
| D-08 | XSS stocké | **PASS** | Aucune réponse HTML côté API ; `image/svg+xml` absent de la liste blanche d'upload (`security.js:359`) | — | NOT TESTED |
| D-09 | CSRF | **NOT APPLICABLE** | L'authentification est portée par un en-tête `Authorization: Bearer`, pas par un cookie de session. `cookieConfig` existe (`security.js:351-355`, `httpOnly`, `secure`, `sameSite: strict`) mais **n'est utilisé nulle part** — recherche exhaustive, aucun `res.cookie` dans `src/` | Retirer `cookieConfig` ou l'utiliser ; du code inerte finit par être branché sans réflexion | — |
| D-10 | CORS verrouillé en production | **PASS** | `security.js:277-288` — refus de démarrage si la liste est vide, jokerisée ou locale | Voir **L-02** pour les sous-domaines | Déjà testé (`securite.test.js:71-137`) |
| D-11 | Validation stricte des corps de requête | **PARTIAL** | `validate.middleware.js` + schémas Joi sur les routes sensibles : connexion, inscription, commandes, promotions, retours, réinitialisation. Mais **absente** sur `adminManagement` (validation à la main dans le contrôleur, `adminManagement.controller.js:23-25`) et sur `deviceToken.route.js` | Porter les schémas Joi sur ces deux routeurs | NOT TESTED |
| D-12 | Plafond de taille du corps | **PASS** | `app.js:127-133` — 512 ko sur JSON et urlencoded, justifié : les fichiers passent par Multer | — | Couvert par `erreurs.http.test.js` |
| D-13 | Plafond de taille et de nombre de fichiers | **PASS** | `security.js:358` 5 Mo ; plafonds par route : `upload.array('images', 8)`, `upload.array('photos', 10)`, `upload.single`, `upload.fields` | — | NOT TESTED |
| D-14 | Type de fichier vérifié sur la **signature réelle** | **PASS** | `upload.middleware.js:8-24, 51-68` — magic bytes PNG / JPEG / PDF, `file.mimetype` **réécrit** avec la valeur détectée, pas celle déclarée | Voir **L-11** (PDF trop largement accepté) | **À ajouter (T-09)** |
| D-15 | Limitation de débit globale | **PASS** | `app.js:138` + `security.js:193-198` — 1000/15 min par IP | — | Déjà testé |
| D-16 | Limitation de débit par compte | **PASS** | `app.js:217` + `security.js:224-230` — 120/min par utilisateur, repli IP normalisé /64 en IPv6 | — | Déjà testé (`securite.test.js:140-151`) |
| D-17 | `trust proxy` correctement réglé | **PASS** | `app.js:12-52` — liste (`loopback`, `uniquelocal`, + variable) et non un nombre ; le raisonnement écrit explique pourquoi `1` et `2` sont tous deux faux | — | NOT TESTED |
| D-18 | Signature des webhooks | **PASS** | Orange : `orangeMoney.service.js:102-135` — HMAC SHA-256, `timingSafeEqual`, **rejet si le secret manque en production** (ligne 111-112). Wave : `wave.service.js:41-58` — HMAC sur `timestamp + corps`, fenêtre anti-rejeu, comparaison à temps constant avec contrôle de longueur | Voir **M-04** (corps brut absent sur `/v1`) | Déjà testé (`webhookOrange.http.test.js`, `waveSignature.test.js`) |
| D-19 | Idempotence des webhooks | **PARTIAL** | `confirmerPaiement` est appelé avec le `transactionId` de l'opérateur, et `paiementApresCommit.test.js` couvre l'ordre d'écriture. Je n'ai pas vérifié qu'un rejeu du même `transactionId` est sans effet | À vérifier avant l'ouverture du paiement en ligne | **NOT TESTED** |
| D-20 | Transactions sur les opérations sensibles | **PASS** | `commande.service.js` (création), `vendeur.service.js:144, 184`, `account.service.js:197`, `admin.management.service.js:22, 122` | — | NOT TESTED |
| D-21 | Conditions de course sur le stock | **PASS** *(rectifié)* | `commande.service.js:124-134` — `_verrouillerProduits` fait un `SELECT … FOR UPDATE` (`lock: transaction.LOCK.UPDATE`) **et** trie par `id ASC` pour éviter les interblocages entre deux commandes concurrentes. S'y ajoutent un cumul par produit dans le même panier (`commande.service.js:288-303`, qui corrige le cas « 2 + 2 pour un stock de 3 ») et un garde-fou d'idempotence sur la sortie de stock (`commande.service.js:143`, `if (commande.stockDecremente) return`) | — | **À ajouter (T-19)** : deux créations concurrentes sur le dernier article, une seule aboutit |
| D-22 | Pollution de paramètres | **NOT TESTED** | Express 5 range les paramètres répétés en tableau. Les schémas Joi devraient les refuser là où ils s'appliquent, mais je ne l'ai pas exercé | — | **NOT TESTED** |
| D-23 | Messages d'erreur sans détail interne | **PASS** | `errorHandler.middleware.js:136, 141` — la pile ne part qu'au journal ; en production, un message non maîtrisé sur un 500 est remplacé | — | Déjà testé (`erreurs.http.test.js`, `erreurs.test.js`) |
| D-24 | Pas de secret dans les réponses | **PASS** | `webhookOrange.http.test.js:62-68` vérifie que `pay_token` ne revient pas ; attributs explicites dans toute la vitrine (`vitrine.route.js:21-22`) | — | Déjà testé |
| D-25 | **Une décision de modération prend effet** | **PASS** *(corrigé le 23/11)* | Trois verrous, là où il n'y en avait aucun : `rejeterProduit` écrit `disponible: false` avec le statut ; `PRODUIT_VISIBLE` borne les **douze** requêtes de `acheteurs.service.js` ; la création de commande refuse un produit `rejete` ; et `_restaurerStock` ne remet en ligne qu'un produit `approuve` | Appliquée — voir **4.1** et **4.1 bis** | **22 tests**, dont **14 échouent sans les correctifs** |
| D-26 | Le filtre de visibilité est appliqué sur les surfaces récentes | **PASS** | `catalogue.service.js:180, 241, 350, 362` · `vitrine.service.js:302` · `categorie.service.js:69` · `accueil.service.js:633` — toutes exigent `statut: 'approuve'`. Ce sont elles qui ont servi de modèle au correctif du service hérité | — | Couvert par `visibiliteProduitRejete.test.js` |
| D-27 | Format des identifiants d'URL validé avant la requête SQL | **PARTIAL** | Validé explicitement à deux endroits seulement : `vendeur.service.js:612` (`UUID.test`, avec le commentaire « ferait échouer la requête SQL en erreur 500 ») et `message.service.js:201, 208` (`FORMAT_UUID`). Les ~40 autres routes à `:id` transmettent la valeur brute à Sequelize | **Un seul middleware de validation de paramètres** fermerait les ~40 routes d'un coup — le garde-fou unique plutôt que quarante rustines | **NOT TESTED** : je n'ai pas pu observer le 500, faute de PostgreSQL ici. Le commentaire du dépôt l'affirme, ce n'est pas ma propre preuve |

### E. Jetons, sessions et cookies

| N° | Contrôle | État | Preuve | Correction | Test |
|---|---|---|---|---|---|
| E-01 | Secrets JWT exigés et solides | **PASS** | `security.js:36-40` — ≥ 32 caractères, **démarrage refusé** sinon | — | Déjà testé (`securite.test.js:35-40`) |
| E-02 | Secrets distincts par usage | **PASS** | `security.js:42-46` — démarrage refusé si deux secrets coïncident. C'est ce qui ferme la confusion entre jeton d'accès, de rafraîchissement et de réinitialisation | — | Déjà testé (`securite.test.js:50`) |
| E-03 | Valeurs d'exemple refusées en production | **PASS** | `security.js:48-57` | — | Déjà testé (`securite.test.js:57`) |
| E-04 | Algorithme épinglé | **FAIL** | `auth.middleware.js:29`, `authOptionnel.middleware.js:28`, `socket.service.js:33` — `jwt.verify(token, secret)` sans options — voir **L-01** | Ajouter `{ algorithms: ['HS256'] }` | **À ajouter (T-10)** |
| E-05 | `issuer` / `audience` vérifiés | **FAIL** | Non émis, non vérifiés — voir **L-01** | Les poser à l'émission et les exiger à la vérification | À ajouter |
| E-06 | Expiration du jeton d'accès | **PASS** | `security.js:61` — 1 h par défaut | — | NOT TESTED |
| E-07 | Signature vérifiée **avant** toute I/O | **PASS** | `auth.middleware.js:28-33` et son commentaire : un jeton fabriqué est rejeté sans requête en base | Voir **L-07** : `authOptionnel` fait l'inverse | NOT TESTED |
| E-08 | Rejeu d'un jeton de rafraîchissement détecté | **PARTIAL** | `refreshToken.service.js:76-82` — un jeton absent de la table est refusé et journalisé. Mais dans les 10 min du délai de grâce, le rejeu **réussit** et évince la session légitime — voir **M-06** | Journaliser en `warn` et révoquer la lignée au second usage | Couvert partiellement par `refreshToken.test.js` |
| E-09 | Rotation à usage unique | **PASS** | `refreshToken.service.js:125-164` — l'ancien est révoqué et horodaté `rotatedAt` à chaque rotation | — | Déjà testé (`refreshToken.test.js`) |
| E-10 | Jetons de rafraîchissement hachés au repos | **PASS** | `refreshToken.service.js:21-23, 47` — SHA-256 ; le jeton en clair ne quitte jamais le service | — | NOT TESTED |
| E-11 | Révocation à la déconnexion réellement effective | **PASS** | `refreshToken.service.js:186-192` (refresh) + `TokenBlacklist` pour le jeton d'accès (`auth.middleware.js:33-36`) | — | Couvert par `socketRevocation.test.js` |
| E-12 | Révocation de toutes les sessions | **PASS** | `refreshToken.service.js:195-202` — appelé au changement et à la réinitialisation du mot de passe, et à la suppression de compte | — | Couvert par `reinitialisationSessions.test.js` |
| E-13 | Expiration d'inactivité | **PASS**, mais la valeur a changé | `security.js:128` + `refreshToken.service.js:99-113` — fenêtre **glissante**, `inactiviteMaxMs` ; l'âge de la ligne tient lieu de « dernier usage », sans écriture supplémentaire. **Était de 3 h quand cet audit a été écrit ; passée à 7 JOURS** par le commit `dbba634` d'un autre développeur, fusionné ici le 23/11. Le mécanisme reste correct ; la protection est sept fois moins serrée — un téléphone perdu reste ouvert une semaine au lieu de trois heures | **Décision de produit, pas un défaut** : à confirmer par l'utilisateur, qui n'a peut-être pas vu l'effet sur la sécurité | Déjà testé (`sessionInactivite.test.js`, mis à jour par le même commit) |
| E-14 | Plafond de sessions simultanées | **PASS** | `refreshToken.service.js:214-227` — au-delà de 20, la plus ancienne est révoquée | — | NOT TESTED |
| E-15 | Purge des jetons expirés | **PASS** | `refreshToken.service.js:233-245` + `jobs/purgeRefreshTokens.job.js` ; les révoqués sont gardés 30 jours pour l'audit | — | NOT TESTED |
| E-16 | Un compte suspendu entre-temps perd ses sessions | **PASS** | `auth.service.js:626-634` — au rafraîchissement, `statut !== 'actif'` déclenche `revoquerTout` | — | NOT TESTED |
| E-17 | Attributs de cookies | **NOT APPLICABLE** | Aucun cookie n'est posé (recherche exhaustive : aucun `res.cookie` dans `src/`) — voir **D-09** | — | — |
| E-18 | Fixation de session | **NOT APPLICABLE** | Pas de session serveur : jetons sans état, nouveaux à chaque connexion | — | — |
| E-19 | Stockage de la session côté back-office | **PASS** | `kodafrik-admin/apps/saambiz/src/utils/storage.js:22` — `sessionStorage`, pas `localStorage` : la session ne survit pas à la fermeture de l'onglet, ce qui compte sur un poste partagé | Reste lisible par JavaScript : c'est la CSP qui porte la défense (**F-02**) | NOT TESTED |

### F. Frontend du back-office (`kodafrik-admin/apps/saambiz`)

| N° | Contrôle | État | Preuve | Correction | Test |
|---|---|---|---|---|---|
| F-01 | XSS DOM | **PASS** | **Aucune** occurrence de `dangerouslySetInnerHTML`, `.innerHTML`, `eval(` ni `new Function` dans les sources des cinq applications (`apps/*/src`) | — | NOT TESTED |
| F-02 | CSP réellement restrictive | **PASS** | `deploy/nginx-entetes.conf:38` — `script-src 'self'` **sans** `unsafe-inline`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, `object-src 'none'` | — | NOT TESTED |
| F-03 | En-têtes posés sur **chaque** `location` | **PASS** | `nginx-entetes.conf:1-13` — le raisonnement écrit est juste : un `add_header` dans un `location` annule ceux du parent, et `always` n'y change rien | — | NOT TESTED |
| F-04 | HSTS | **PASS** | `nginx-entetes.conf:15` — 2 ans, `includeSubDomains`, `preload` ; `app.js:79-83` côté API | — | NOT TESTED |
| F-05 | `nosniff`, `Referrer-Policy`, `noindex` | **PASS** | `nginx-entetes.conf:16-19` | `Permissions-Policy` absent (**L-09**) | NOT TESTED |
| F-06 | Routes privées gardées | **PASS** | `routes/ProtectedRoute.jsx:16-25` — et le fichier **documente lui-même** qu'il ne s'agit pas d'une barrière de sécurité : « l'API vérifie le rôle à chaque requête ». C'est la bonne posture | — | NOT TESTED |
| F-07 | Écran de connexion inaccessible à qui a une session | **PASS** | `routes/GuestRoute.jsx:10-13` | — | NOT TESTED |
| F-08 | Pas de compte de démonstration codé en dur | **PASS** | Aucune constante d'identifiants dans `apps/saambiz/src` | — | NOT TESTED |
| F-09 | Expiration locale non utilisée comme autorité | **PASS** | `utils/storage.js:31-41` — l'en-tête du fichier dit explicitement que la date lue dans la charge utile sert « uniquement à éviter d'envoyer une requête qu'on sait condamnée » | — | NOT TESTED |
| F-10 | Le filtrage visuel ne remplace pas un contrôle d'accès | **PASS** | Les menus envoyés à la connexion (`auth.service.js:493-506`) composent la navigation ; l'autorisation reste `requirePermission` côté serveur (**C-05**) | — | NOT TESTED |
| F-11 | Artefacts de build non versionnés | **PASS** | `git ls-files | grep -c "dist/"` → **0**. Les `dist/` présents sur le disque sont des builds locaux | — | — |
| F-12 | Navigation arrière après déconnexion | **NOT TESTED** | Nécessite un navigateur sur une instance déployée | — | **NOT TESTED** |

### G. Base de données, données sensibles, infrastructure

| N° | Contrôle | État | Preuve | Correction | Test |
|---|---|---|---|---|---|
| G-01 | Identifiants de base jamais exposés | **PASS** | `.gitignore:5-7` (`.env`, `.env.*`, sauf `.env.example`) ; `.dockerignore:3-5` ; `docker-compose.prod.yml:23-25` utilise `${VAR:?}` — **aucune valeur par défaut**, le démarrage échoue si la variable manque | — | — |
| G-02 | Aucun secret dans l'historique Git | **PASS** | `git log --all --diff-filter=A --name-only` filtré sur `.env`, `*.pem`, `*.key`, `*secret*`, `*credential*`, `*serviceaccount*` → **aucun résultat**. Les motifs de clés trouvés dans l'arbre suivi sont des gabarits (`re_xxxx…` dans `.env.example`) et des valeurs factices de test (`FACTICE`, `abc`, `...`) | — | — |
| G-03 | Clé de service Firebase hors dépôt et hors image | **PASS** | `docker-compose.prod.yml:80-93` — montée en **lecture seule** depuis le disque du VPS ; `deploy/` exclu par `.dockerignore:64` et par `.gitignore` | — | Couvert par `pushEnvoi.test.js` |
| G-04 | Port PostgreSQL non publié | **PASS** | `docker-compose.prod.yml:32-33` — `expose` seulement, pas `ports` | — | — |
| G-05 | API publiée sur la boucle locale uniquement | **PASS** | `docker-compose.prod.yml:70` — `127.0.0.1:${HOST_PORT}:3000` | — | — |
| G-06 | Conteneur non-root | **PASS** | `Dockerfile:21-22` — `appuser` système, `USER appuser` | — | — |
| G-07 | Durcissement de conteneur complet | **PARTIAL** | Ni `cap_drop`, ni `security_opt`, ni `read_only` — voir **L-09** | À faire en recette, pas à chaud | — |
| G-08 | Limites de ressources | **PASS** | `docker-compose.prod.yml:118-123` — 512 Mo | — | — |
| G-09 | Rotation des journaux | **PASS** | `docker-compose.prod.yml:42-46, 112-116` | — | — |
| G-10 | Requêtes paramétrées | **PASS** | Voir **D-03** | — | **À ajouter (T-08)** |
| G-11 | Migrations réellement appliquées au déploiement | **PASS** | `docker-compose.prod.yml:79` — `bootstrap.js` avant `server.js`, et le commentaire explique la panne silencieuse que son absence causait | — | Couvert par `migrationsTables.test.js` |
| G-12 | Chiffrement en transit vers la base | **PARTIAL** | `docker-compose.prod.yml:109` — `DB_SSL: false` par défaut, **justifié** : la base n'est joignable que par le réseau Docker interne, et le `.env` peut rétablir l'exigence si la base sort du compose | Rétablir `DB_SSL=true` le jour d'un passage sur base managée | — |
| G-13 | Chiffrement des données sensibles au repos | **FAIL** | Aucun chiffrement applicatif. Les pièces d'identité des vendeurs (`utilisateur.pieceIdentite`, `pieceIdentiteVerso`) sont des références vers un **bucket privé** (`upload.service.js`, `r2.service.js:287` par URL signée) — c'est le bon modèle. Mais noms, emails, téléphones et adresses sont en clair en base | Au minimum : chiffrer les sauvegardes (**M-02**). Chiffrer les colonnes casserait recherche et tri — à ne pas faire sans étude | — |
| G-14 | Accès aux pièces d'identité par URL signée de durée bornée | **PASS** | `r2.service.js:287` `GetObjectCommand` présigné ; couvert par `certificationLiensSignes.test.js` (exécuté, vert) | — | Déjà testé |
| G-15 | Journaux sans secrets | **PASS** | `paiement.controller.js:81-90` — le corps entier n'est plus imprimé, seuls `order_id` et `status` ; `push.service.js:375` journalise une **empreinte** du jeton d'appareil, pas le jeton | — | Couvert par `pushJournalisation.test.js` |
| G-16 | Pile d'appels hors des réponses | **PASS** | `errorHandler.middleware.js:136` — `err.stack` au journal uniquement | — | Déjà testé |
| G-17 | Swagger désactivé en production | **PASS** | `app.js:156-161` | — | NOT TESTED |
| G-18 | Sauvegardes automatiques | **FAIL** | `setup-server.sh:112-114` — la ligne de cron est **affichée**, qualifiée d'« optionnel », jamais installée. Aucun appel à `backup-postgres.sh` dans `deploy.sh` — voir **M-02** | **Ton action** — section 8 | — |
| G-19 | Sauvegardes chiffrées | **FAIL** | `backup-postgres.sh` — `pg_dump \| gzip`, aucun chiffrement | Chiffrer avec `age` ; **la clé privée ne doit jamais se trouver sur le serveur** | — |
| G-20 | Sauvegardes hors site | **FAIL** | `backup-postgres.sh:19` — `BACKUP_DIR="${APP_DIR}/backups"`, sur la machine de la base | Copier vers un stockage distant | — |
| G-21 | Restauration testée | **NOT TESTED** | Aucun script de restauration, aucune procédure documentée | Écrire et **exécuter une fois** une restauration sur une base jetable | — |
| G-22 | Exfiltration massive détectable | **PARTIAL** | Toutes les requêtes HTTP sont journalisées avec utilisateur, URL, statut et durée (`app.js:141-154`), et les refus RBAC en `warn` (`requirePermission.middleware.js:72-78`). Mais **aucune alerte**, aucun seuil, aucune détection d'anomalie | Alerter sur les séries de refus RBAC et sur les volumes anormaux | — |
| G-23 | Piste d'audit retraçable | **PASS** | `auditLog.model.js` + `audit.service.js`. Sont journalisés : création, modification et suppression d'admin, **modification de permissions** (`adminManagement.controller.js:28, 42, 48, 62`), connexions d'administrateurs (`auth.service.js:478-486`), modifications de configuration (`config.controller.js`, `centreAide.controller.js`), suppression de compte (`account.service.js:254-261`). Acteur, action, cible, détails, date — sans secret | Ne couvre pas les actions **métier** d'un admin sur une boutique (suspension, suppression de produit) : à vérifier dans `admin.controller.js` | NOT TESTED |
| G-24 | TLS et reverse proxy | **NOT TESTED** | `deploy/nginx.conf` lu, mais la configuration **réellement active** sur le VPS n'est pas vérifiable d'ici — et je n'y touche pas | **Ton action** : vérifier les protocoles et suites acceptés | — |
| G-25 | Pare-feu, SSH, ports exposés | **NOT TESTED** | Hors d'atteinte depuis ce poste, et hors de ce que je m'autorise à sonder | **Ton action** | — |
| G-26 | Séparation dev / recette / production | **PARTIAL** | `NODE_ENV` commande les protections, et `security.js:126-132` **refuse de démarrer** si les limites de débit sont désactivées sur une instance déclarée publique — garde-fou intelligent. Mais il n'existe pas d'environnement de recette distinct | Un environnement de recette rendrait sûrs les correctifs d'infrastructure | Déjà testé (`securite.test.js:168`) |
| G-27 | Dépendances sans vulnérabilité connue | **FAIL** | `npm audit --omit=dev` → **29 alertes *high***, racine unique `zod < 4.6.6` (GHSA-mrhx-c7xc-m3w5) via `jimp` — voir **M-03** | `npm audit fix` | — |
| G-28 | Cohérence du fichier de verrouillage | **PASS** | `package-lock.json` présent et versionné ; `Dockerfile:7` utilise `npm ci --omit=dev`, qui échoue si le verrou diverge de `package.json` | — | — |
| G-29 | Paquets abandonnés ou douteux | **PASS** | Les 30 dépendances de production sont des paquets de référence largement maintenus (express, sequelize, helmet, joi, bcryptjs, jsonwebtoken, sharp, socket.io, winston…). `overrides` force `uuid`, `glob`, `minimatch` à des versions saines | — | — |
| G-30 | Scripts d'installation sans exécution arbitraire | **PASS** | Aucun `postinstall`, `preinstall` ni `prepare` dans `package.json` | — | — |
| G-31 | Secrets et permissions des pipelines | **FAIL** | `.github/workflows/ci.yml` — aucun bloc `permissions:`, donc droits par défaut du dépôt pour `GITHUB_TOKEN` — voir **L-08** | `permissions: contents: read` | — |
| G-32 | Vérification avant arrivée sur `main` | **FAIL** | `ci.yml:12-14` — `pull_request` et `workflow_dispatch` seulement — voir **L-08** | Ajouter `push: branches: [main]` | — |
| G-33 | Passage sécurité en CI | **FAIL** | Aucune étape `npm audit`, aucun test de sécurité dédié dans le pipeline | Ajouter les deux | **À ajouter (T-11)** |

---

## 4. Tableau des corrections

### 4.1 Corrections APPLIQUÉES — les sept sans risque de contrat

L'utilisateur a autorisé les sept correctifs qui ne peuvent pas casser une
application mobile publiée : deux au périmètre admin, cinq dont le changement
de comportement ne concerne que des cas qu'aucun client n'émet.

| # | Défaut | Correction appliquée | Fichiers | Test |
|---|---|---|---|---|
| 1 | **H-01** *(atténuation)* | `rejeterProduit` écrit `disponible: false` en même temps que `statut: 'rejete'`. Le statut seul ne retirait rien ; `disponible` est la colonne que **la création de commande** consulte, donc la vente est bloquée. `approuverProduit` ne fait **pas** la symétrie : l'interrupteur « En ligne » appartient au vendeur | `src/services/admin/admin.service.js:414` | `visibiliteProduitRejete.test.js` — 2 tests, dont la non-symétrie |
| 2 | **L-06** · C-13, C-14 | Trois garde-fous : refus de l'auto-suppression, refus de supprimer le **dernier** administrateur (sinon le back-office devient inaccessible à tous, sans issue hors intervention en base), et `updatePermissions` exige que la cible soit un administrateur. L'identité du demandeur vient du **jeton**, jamais du corps | `src/services/admin.management.service.js:122, 176`<br>`src/controllers/adminManagement.controller.js` | `cloisonnementAdmin.test.js` — 2 tests basculés de `it.failing` à `test` |
| 3 | **L-01** · E-04 | Algorithme épinglé, **en un seul endroit** : `jwtConfig.optionsVerification = { algorithms: ['HS256'] }`, consommé par les **cinq** appels de vérification (les deux middlewares, la poignée de main des sockets, les deux vérifications de jeton de rafraîchissement). Cinq copies de la même option auraient fini par diverger | `src/config/security.js:95`<br>+ 5 appels | `authentificationDurcie.test.js` — un jeton HS512 signé du bon secret est désormais refusé |
| 4 | **L-05** · A-27 | Nouvel utilitaire `choisirDansTable(table, cle, defaut)` qui s'appuie sur `Object.hasOwn` : la recherche ne traverse plus la chaîne des prototypes. Appliqué aux deux tables de tri | `src/utils/choixDansTable.js` *(nouveau)*<br>`catalogue.service.js:227`<br>`vitrine.service.js:508` | `validationEntrees.test.js` — `tri=constructor` et `tri=__proto__` retombent sur le tri par défaut |
| 5 | **L-07** · E-07 | `authOptionnel` vérifie la **signature avant** de consulter la liste noire, comme `auth.middleware` | `src/middlewares/authOptionnel.middleware.js:38` | `authentificationDurcie.test.js` — un jeton malformé ne déclenche plus aucune requête |
| 6 | **L-04** | Référence de commande tirée par `crypto.randomInt` sur un alphabet base 36, **six caractères garantis** (`Math.random().toString(36)` en rendait entre 1 et 6 selon le tirage, réduisant d'autant l'espace) | `src/services/commandes/commande.service.js:86-116` | `authentificationDurcie.test.js` — format, 10 000 tirages sans collision, distribution sur les 36 caractères, et absence de `Math.random` |
| 7 | **M-04** | Le corps brut des webhooks est conservé par le `verify` d'`express.json`, pour **Orange et Wave**, donc **aux deux adresses** du routeur. L'ancien middleware dédié à Orange est retiré : il appelait `next()` sans attendre la fin du flux, donc il courait contre le parseur qui lit le même flux | `src/app.js:138` | `webhookOrangeCorpsBrut.http.test.js` *(nouveau)* — 9 tests. **Vérifié : il échoue sur le code d'origine**, à l'adresse `/saambiz/v1/` exactement, l'alias passant — ce qui confirme M-04 tel que décrit |

**Suite complète après ces sept correctifs : `68 suites, 1343 tests, tous verts`.**
Aucune régression.

### 4.1 bis Correction de H-01 EN ENTIER — autorisée après coup

L'utilisateur a ensuite arbitré en faveur de la version complète. Elle touche
deux services du périmètre mobile, et c'est pour cela qu'elle attendait son
accord.

**Vérifié AVANT d'appliquer**, parce que ce correctif change ce que
l'application publiée affiche :

- **`GET /acheteurs/produit/:id` n'a aucun appelant dans l'application.**
  L'endpoint est déclaré (`api_endpoints.dart:44`) et jamais utilisé : l'écran
  de détail passe par `/catalogue/produits/:id`
  (`catalogue_remote_datasource.dart:62`), qui filtrait **déjà**
  `statut: 'approuve'`. Le risque redouté sur cette route était donc nul.
- **L'écran de détail dégrade proprement** en cas d'échec : un `catch` conserve
  la fiche déjà affichée et arrête le chargement des produits similaires. Pas
  de plantage, pas de message technique.
- **Le contact WhatsApp affiche un message en français** (« WhatsApp n'a pas pu
  s'ouvrir. Réessayez. ») et cette route répondait **déjà** 404 quand le vendeur
  n'a pas d'abonnement actif : aucun nouveau mode de défaillance.
- **L'historique des commandes est structurellement insensible au filtre.**
  `LigneCommande` garde `nomProduit`, `imageProduit` et `prixUnitaire` en
  propre, et **aucune** requête de `commande.service.js` ne joint `Produit` —
  vérifié, et retenu par deux tests. « Plus au catalogue » n'est pas « effacé
  du passé ».

| # | Correction | Fichiers | Preuve |
|---|---|---|---|
| 8 | **Filtre de visibilité centralisé** : `PRODUIT_VISIBLE`, une constante **gelée**, posée sur les **douze** requêtes du service. Une constante et non douze `statut: 'approuve'` recopiés — c'est l'oubli sur la treizième requête qui rouvrirait le trou, et un oubli ne se voit pas à la lecture. Les deux `findByPk` deviennent des `findOne` avec `where`, précisément pour pouvoir borner | `src/services/acheteurs/acheteurs.service.js` | 10 tests sur les listes + 2 sur la fiche et le détail de boutique + 1 sur l'unicité de la constante |
| 9 | **La commande refuse un produit retiré.** Seule exception à la tolérance accordée au vendeur, qui peut vendre au comptoir un article hors ligne ou en rupture : il ne peut pas vendre un article que la plateforme a retiré | `src/services/commandes/commande.service.js` | 1 test — `Commande.create` n'est pas appelé |
| 10 | **Le retour de stock ne défait plus une décision de modération** (`_restaurerStock`). C'était le trou qui se rouvrait tout seul : annuler une commande portant un article entre-temps retiré le remettait en vente, sans trace. Le stock revient — le vendeur l'a physiquement — mais l'article ne repart pas en vente | `src/services/commandes/commande.service.js` | 3 tests de **comportement** : approuvé → repasse en ligne, rejeté et en attente → restent hors ligne |

**Suite complète : `68 suites, 1356 tests, tous verts`.**
**14 des 22 tests de `visibiliteProduitRejete.test.js` échouent sans ces
correctifs** — vérifié en restaurant le code d'origine.

Deux de mes propres tests ont été refaits en route, et c'est instructif :

- l'assertion sur la requête de la fiche produit portait sur
  `findByPk(id, options)`. Le correctif passe à `findOne`, donc elle aurait
  continué d'« échouer » sur un `mock.calls[0]` absent — c'est-à-dire de passer
  en `it.failing` alors que le défaut était corrigé ;
- la vérification de `_restaurerStock` n'était qu'une **expression régulière
  sur le fichier source**. Elle serait passée au vert sur un commentaire
  contenant la bonne phrase. Remplacée par trois tests qui exercent le
  comportement.

**`it.failing` restants dans tout le dépôt : 2**, tous deux pour **M-01**, que
l'utilisateur n'a pas autorisé. Les cinq de H-01 sont devenus des tests verts.

#### Ce que les sept premiers correctifs ne faisaient PAS

Il faut le dire précisément, sinon le tableau ci-dessus se lit comme une
victoire qu'il n'est pas :

- **H-01 n'est pas corrigé, il est atténué.** `disponible: false` bloque la
  vente — la conséquence la plus coûteuse — et retire le produit des surfaces
  qui filtrent `disponible` (détail d'une boutique, tendances, découverte,
  recherche globale). Mais **7 des 12 méthodes** de `acheteurs.service.js` ne
  filtrent ni `statut` ni `disponible` : le produit rejeté reste consultable,
  notamment par `GET /acheteurs/produit/:id`. La correction à la source est le
  filtre de visibilité centralisé, qui touche le périmètre mobile.
- **Une limite de l'atténuation, trouvée en l'appliquant.** `_restaurerStock`
  (`commande.service.js`) remet `disponible = true` dès que la quantité
  repasse au-dessus de zéro, **sans regarder `statut`**. Annuler une commande
  qui portait un produit entre-temps rejeté le remet donc en vente. Le
  correctif est d'une ligne — `&& produit.statut === 'approuve'` — mais il est
  dans un service du périmètre mobile. Documenté par un `it.failing`.
- **M-01 n'est pas corrigé** : il change le message de connexion d'un compte
  suspendu, donc un comportement que l'application mobile affiche.
- **L-03 n'est pas corrigé** : un compte suspendu recevrait désormais un 403
  sur `/device-token/register`, que l'application appelle.
- **Un troisième site du défaut L-05 trouvé en le corrigeant, et laissé en
  place** : `categorieBoutique.service.js:78` fait
  `(ALIAS_CATEGORIES[cle] || []).forEach(…)` où `cle` vient du client. Pour
  `cle = 'constructor'`, c'est `Object.forEach` — une `TypeError`, donc un 500
  sur une route vendeur authentifiée. `choisirDansTable` le corrigerait en une
  ligne, mais le fichier est au périmètre mobile.

### 4.2 Corrections PRÊTES, en attente de décision

Les cinq restantes, dans l'ordre où je les ferais.

| Ordre | FAIL / Vulnérabilité | Cause réelle | Correction | Fichiers | Test qui échoue sans le correctif | Risque de régression |
|---|---|---|---|---|---|---|
| 1 | **H-01** — le rejet de modération ne retire pas vraiment | Les 12 méthodes de `acheteurs.service.js` ne filtrent jamais `statut` ; `commande.service.js` non plus | Filtre de visibilité centralisé (`statut: 'approuve'`) dans `acheteurs.service.js`, contrôle du statut à la création de commande, et `&& produit.statut === 'approuve'` dans `_restaurerStock` | `acheteurs.service.js`, `commande.service.js` | **T-22** : les 5 `it.failing` de `visibiliteProduitRejete.test.js` passent au vert | **PÉRIMÈTRE MOBILE** — des produits aujourd'hui visibles disparaîtraient des listes. C'est l'effet voulu, à confirmer |
| 2 | **B-07, B-08 / M-01** — énumération de comptes | Les contrôles d'état du compte précèdent la vérification du mot de passe | Déplacer les blocs `compteSupprime` et `statut !== 'actif'` **après** `bcrypt.compare` | `src/services/auth.service.js` | **T-04** : un mot de passe faux sur un compte suspendu renvoie le message générique ; le bon mot de passe renvoie toujours le message précis | **Faible.** Le message utile est conservé pour l'utilisateur légitime |
| 3 | **L-03** — `checkActiveUser` manquant | Oubli : seul routeur authentifié sans ce middleware | `router.use(checkActiveUser)` | `src/routes/deviceToken.route.js` | **T-13** : un compte `inactif` reçoit 403 sur `/device-token/register` | **Faible.** Aligne ce routeur sur les dix autres |
| 4 | **L-11** — PDF accepté partout | Liste blanche unique pour toutes les routes | Paramétrer `verifyMagicBytes` par types attendus ; PDF réservé à la pièce d'identité | `upload.middleware.js`, routes concernées | **T-09** : un PDF est refusé comme photo de produit, accepté comme pièce d'identité | **Moyen** — à vérifier depuis l'application mobile |
| 5 | **G-33, G-31, G-32 / L-08** — CI | Déclencheurs et permissions incomplets | `push: branches: [main]`, `permissions: contents: read`, étape `npm audit --omit=dev --audit-level=high` | `.github/workflows/ci.yml` | Le pipeline lui-même | **Faible** — mais c'est de la livraison : à relire avec toi |
| 6 | **M-03 / G-27** — `zod` vulnérable | Transitive via `jimp` | `npm audit fix` | `package-lock.json` | `npm audit --audit-level=high` sort à 0 | **À surveiller** : modifie le verrou, donc l'image. Pas à chaud |
| 7 | **M-06** — délai de grâce et vol de jeton | Le rejeu évince la session légitime | Journaliser en `warn`, compter ; au second usage d'un jeton tourné, révoquer la lignée | `refreshToken.service.js` | **T-18** : deux rejeux du même jeton tourné ferment toutes les sessions du compte | **Moyen** — arbitrage d'expérience utilisateur, à décider avec toi |

**Non corrigeables par moi** — ils relèvent de toi : **M-02** / G-18 à G-21
(sauvegardes), **M-05** / B-09 (vérification d'email), **B-16** (MFA des admins),
**G-07** / L-09 (durcissement du conteneur), **G-24**, **G-25** (TLS, pare-feu, SSH),
**G-22** (alertes), **L-10** (sort du rôle `SuperAdmin`). Voir section 8.

---

## 5. Audit multi-boutiques

### Ce qu'est un « tenant » ici

SaamBiz n'a pas d'entité « entreprise ». La frontière d'isolation est le **vendeur**,
et sa boutique : `boutique.vendeurId` est unique, `produit.vendeurId`,
`commande.vendeurId` et `commande.acheteurId` portent la relation. C'est un modèle
**à un seul niveau** — ce qui le simplifie beaucoup, et c'est la première bonne
nouvelle de cet audit : il n'y a ni appartenance multiple, ni invitation, ni rôle
multi-entreprises, ni bascule de contexte. Autant de surfaces d'attaque qui
n'existent pas (A-36).

### Mécanismes d'isolation

Il y en a **un seul**, appliqué partout, et c'est sa force :

```
Produit.findOne({ where: { id: produitId, vendeurId } })
```

Le `vendeurId` vient de `req.user.id`, posé par `auth.middleware.js:38-44` depuis
l'identifiant signé dans le jeton. Aucun contrôleur ne lit un `vendeurId` ou un
`tenantId` dans le corps, l'URL ou un en-tête — je l'ai cherché sur l'ensemble de
`src/`. **Le client ne désigne jamais son propre tenant.** C'est le point qui ferme
l'essentiel des attaques BOLA.

Pourquoi borner dans le `where` plutôt que vérifier après coup est important : un
filtre à la source ne peut pas être oublié par une branche de code. Une vérification
post-chargement, elle, se contourne dès qu'un nouveau chemin d'appel apparaît — et
elle finit toujours par apparaître. `paiement.controller.js:141-143` est le seul
endroit qui procède après coup ; c'est correct aujourd'hui, c'est juste plus fragile.

### Routes testées — accès par identifiant

Vérifiées par lecture de code, avec la ligne exacte en preuve (section 3 A) :

| Route | Borne | Référence |
|---|---|---|
| `PUT /vendeur/modifier-produit/:id` | `{ id, vendeurId }` | `vendeur.service.js:146-151` |
| `DELETE /vendeur/supprimer-produit/:id` | `{ id, vendeurId }` | `vendeur.service.js:186` |
| `PATCH /vendeur/produit/:id/disponibilite` | `{ id, vendeurId }` | `vendeur.service.js:1126` |
| `POST /vendeur/produit/:id/dupliquer` | `{ id, vendeurId }` | `vendeur.service.js:1153` |
| `POST /vendeur/produit/:id/images` | `{ id, vendeurId }` | `vendeur.service.js:1262` |
| `DELETE /vendeur/produit/:id/images/:imageId` | produit puis image | `vendeur.service.js:1289-1292` |
| `DELETE /vendeur/ma-vitrine/photos/:photoId` | via `_modifierPhotosVitrine(vendeurId, …)` | `vendeur.service.js:735` |
| `GET /vendeur/abonnes/:id` | boutique du vendeur, puis favori | `vendeur.service.js:610-619` |
| `GET /commandes/:id` | acheteur **ou** vendeur concerné | `commande.service.js:664-668` |
| `PATCH /commandes/:id/statut` | vendeur concerné | `commande.service.js:705` |
| `PATCH /commandes/:id/paiement` | vendeur concerné | `commande.service.js:786` |
| `PUT /commandes/:id/annuler` | acheteur concerné | `commande.service.js:899` |
| `POST /commandes/:id/demande-annulation` | acheteur concerné | `commande.service.js:938` |
| `PATCH /commandes/:id/demande-annulation` | vendeur concerné | `commande.service.js:982` |
| `GET /paiement/:paiementId` | propriétaire (après chargement) | `paiement.controller.js:141` |
| `GET /messages/:userId` | les deux participants | `message.service.js:82-87` |
| `PUT /messages/:messageId/lire` | destinataire | `message.service.js:168` |
| `PUT /messages/site/:id/lire` | vendeur, + format UUID | `message.service.js:201-202` |
| `DELETE /messages/site/:id` | vendeur, + format UUID | `message.service.js:208-209` |
| `PUT /notifications/:id/lire` | propriétaire | `notification.service.js:104` |
| `DELETE /avis/boutique/:boutiqueId` | auteur | `avis.service.js:101` |

**Aucune de ces routes ne laisse passer un identifiant appartenant à autrui.**

### Tables et relations concernées

`utilisateur`, `boutique`, `produit`, `produit_image`, `commande`,
`ligne_commande`, `historique_commande`, `paiement`, `abonnement`, `promotion`,
`favori`, `message`, `message_site`, `notification`, `avis`, `visite_boutique`,
`demande_retour`, `signalement`, `device_token`, `permission`, `menu`,
`refresh_token`, `token_blacklist`, `audit_log`.

### Risques cross-boutique restants

1. ~~Aucun test n'exerce l'isolation.~~ **Fermé.** C'était le risque le plus
   concret de cet audit : la protection était bonne et **tenue par rien**, de
   sorte qu'un remaniement remplaçant `findOne({ where: { id, vendeurId } })`
   par `findByPk(id)` aurait passé la CI au vert. `isolationVendeurs.test.js`
   (15 tests) et `isolationCommandes.test.js` (19 tests) le retiennent
   désormais, et leurs assertions portent sur la **clause `where`** elle-même.
2. **Statistiques vendeur (A-25) : toujours non testées.** Les agrégats portent
   bien `vendeurId`, mais ce sont des requêtes SQL brutes — l'endroit exact où
   une erreur ne se voit pas. **T-03 reste à écrire** : il demande de doubler
   `sequelize.query`, ce que mes fichiers actuels ne font pas.
3. ~~Conditions de course sur le stock : non prouvées.~~ **Rectifié : le
   verrouillage est bien là** (`SELECT … FOR UPDATE` avec tri par `id` contre les
   interblocages, `commande.service.js:124-134`). Reste à l'exercer par un test
   (T-19), mais le code est correct.
4. **`paiement.controller.js:141`** vérifie après chargement, non dans la requête.
   Correct, plus fragile que le reste.

### Vulnérabilités d'isolation restantes

**Aucune confirmée.** Et la nuance compte : cela ne veut pas dire qu'il n'y en a
pas, cela veut dire que je n'en ai pas trouvé sur les 21 routes ci-dessus, par
lecture de code, sans avoir pu exécuter une requête réelle contre une base peuplée
de deux boutiques. Les tests T-01 à T-03 transformeraient cette lecture en preuve.

---

## 6. Sécurité de l'administration

| Exigence | État | Preuve |
|---|---|---|
| Les routes d'administration sont inaccessibles à un utilisateur normal | **PASS** | `admin.route.js:16-18` et `adminManagement.route.js:12-14` — chaîne `auth` → `checkActiveUser` → `isAdmin`. `isAdmin.middleware.js:8` renvoie 403 si `role !== 'Admin'`. Un vendeur ou un client muni d'un jeton valide est refusé |
| Un administrateur ne peut pas s'auto-promouvoir | **PASS** | Toute modification de permission exige déjà `ADMINS/update` (`adminManagement.route.js:33`). **Propriété à connaître plutôt que défaut : qui détient `ADMINS/update` détient de fait l'accès total.** C'est inhérent au modèle, pas un contournement |
| Un administrateur ne peut pas administrer une autre entreprise sans permission | **NOT APPLICABLE** | Il n'y a pas d'administration par entreprise : les administrateurs sont ceux de la plateforme et voient l'ensemble des boutiques par conception. Le cloisonnement administratif se fait par **menu et action** (`requirePermission`), pas par boutique |
| Les statistiques d'administration ne divulguent rien d'indu | **PASS** | `/admin/stats-globales` est derrière `requirePermission` comme les 83 autres. Son contenu — comptages globaux — est l'objet même de la route |
| Les actions critiques sont journalisées | **PASS** | `auditLog.model.js` + `audit.service.js`. Couvrent : création, modification, suppression d'administrateur, **modification de permissions** (`adminManagement.controller.js:28, 42, 48, 62`), connexions d'administrateurs (`auth.service.js:478-486`), modifications de configuration, suppressions de compte. Acteur, action, cible, détails, horodatage — **sans secret** |
| Les sessions privilégiées sont sécurisées | **PARTIAL** | `sessionStorage` et non `localStorage` (`storage.js:22`) ; inactivité **à 7 jours** depuis `dbba634` (3 h auparavant — voir E-13) ; plafond de sessions ; révocation immédiate. Mais **aucun second facteur** (B-16), et la session d'un administrateur suit exactement les mêmes règles que celle d'un client |
| Le dernier administrateur ne peut pas disparaître | **FAIL** | `admin.management.service.js:99-106` — aucun garde-fou. Un administrateur peut se supprimer, ou supprimer tous les autres : verrouillage complet du back-office (**L-06**) |

**Point notable.** Les cinq applications du back-office partagent une seule origine,
donc un seul `sessionStorage` — une faille XSS dans l'une atteindrait les sessions
des quatre autres. `nginx-entetes.conf:21-25` l'identifie explicitement et y répond
par une CSP `script-src 'self'` sans `unsafe-inline`. Le raisonnement et la mesure
sont tous les deux justes.

---

## 7. Tests exécutés

### Environnement

- macOS (Darwin 27.0.0), Node.js 22, Jest 30.5.1
- `Saambiz_Back` au commit local `d0231d2` — avec les modifications non committées
  d'une autre session (`src/utils/formatUser.js` + son test), que je n'ai pas touchées
- **Sans PostgreSQL.** C'est une limite à connaître : les tests d'intégration
  tolèrent l'absence de base et répondent 503 au lieu d'exercer les requêtes. Les
  tests unitaires utilisent des doublures de modèles

### Suite complète du dépôt

```
npx jest --silent
```

**Résultat** : `Test Suites: 59 passed, 59 total` · `Tests: 932 passed, 932 total` ·
`Time: 5.825 s` · code de sortie **0**.

Exécutée **une seule fois**, comme référence. Je n'ai rien modifié, donc il n'y a
rien à comparer : aucune régression possible, et aucun mérite à l'annoncer.

### Audit de dépendances

```
npm audit --omit=dev
```

**Résultat** : **29 vulnérabilités *high***, racine unique `zod < 4.6.6`
(GHSA-mrhx-c7xc-m3w5), transitive via `jimp`. `fixAvailable: true`.

### Couverture RBAC des routes d'administration

Script de comptage sur `admin.route.js` et `adminManagement.route.js`, puis
contre-vérification par deux `grep` indépendants.

**Résultat** : **84 routes, 84 `requirePermission`, 0 route sans permission fine.**

### Recherche d'injection SQL

Script parcourant `src/` et extrayant toute interpolation `${…}` à l'intérieur d'un
`sequelize.query(\`…\`)` ou `literal(\`…\`)`.

**Résultat** : **6 blocs**. 4 n'interpolent que des coordonnées passées par
`parseFloat` + `isNaN` + bornes ; 2 interpolent des constantes SQL figées.
**Aucune injection.**

### Recherche de secrets dans l'historique Git

```
git log --all --diff-filter=A --name-only
```
filtré sur `.env`, `*.pem`, `*.key`, `*secret*`, `*credential*`, `*serviceaccount*`,
puis `git grep` sur les motifs de clés AWS, Stripe, Resend et PEM.

**Résultat** : **aucun secret**. Les correspondances sont des gabarits
(`.env.example`) et des valeurs factices de test.

### Vérification du repli de tri (L-05)

```
node -e 'const O={pertinence:1}; console.log(!!O["constructor"], !!O["__proto__"])'
→ true true
```

Confirme que le repli `ORDRES[tri] || ORDRES.pertinence` est contourné par la chaîne
de prototypes. **L'effet HTTP n'a pas été observé** faute de base : d'où le
classement « non confirmé » en L-05.

### Tests de sécurité ajoutés et exécutés

**6 fichiers, 108 tests, 2 215 lignes.** Aucun fichier de code modifié.

```
npx jest tests/unitaires/isolationVendeurs.test.js \
         tests/unitaires/visibiliteProduitRejete.test.js \
         tests/unitaires/isolationCommandes.test.js \
         tests/unitaires/cloisonnementAdmin.test.js \
         tests/unitaires/authentificationDurcie.test.js \
         tests/unitaires/validationEntrees.test.js
→ Test Suites: 6 passed  ·  Tests: 108 passed
```

Et la suite complète du dépôt, après leur ajout :

```
npx jest
→ Test Suites: 67 passed, 67 total  ·  Tests: 1329 passed, 1329 total
```

**Aucune régression.** Les 1 214 tests qui existaient avant passent toujours.
(L'écart de 115 tient à mes 108, plus 7 venus de la session qui travaillait en
parallèle dans ce dépôt.)

| Fichier | Tests | Ce qu'il retient |
|---|---|---|
| `isolationVendeurs.test.js` | 15 | Le vendeur B contre le vendeur A sur 8 routes produit : modification, suppression, disponibilité, duplication, ajout et retrait d'images, recherche, abonnés. **Les assertions portent sur la clause `where`**, pas seulement sur le refus — un service qui chargerait sans contrainte puis comparerait passerait un test « ça refuse » tout en restant fragile. Plus le mass assignment (`vendeurId`, `statut`, `vues` ignorés) et les opérations en masse |
| `isolationCommandes.test.js` | 19 | Les 6 mutations de commande contre un tiers ; les listes bornées ; un panier qui ne peut pas mélanger deux boutiques ; **le montant recalculé en base** (un prix de 1 FCFA annoncé par le client est ignoré, 2 × 25 000 est enregistré) ; le verrouillage `FOR UPDATE` et son tri anti-interblocage |
| `cloisonnementAdmin.test.js` | 17 | **Le garde-fou qui retient le compte de 84 routes** : une route d'administration ajoutée sans `requirePermission` fera désormais échouer la suite, en la nommant. Plus : `role`/`statut`/`verifie`/`soldeDisponible` inatteignables depuis le corps, routes « utilisateurs » incapables d'atteindre un administrateur, création d'utilisateur incapable de créer un admin |
| `authentificationDurcie.test.js` | 16 | Les trois secrets distincts et l'impossibilité d'utiliser un jeton pour un autre usage ; `alg: none` refusé ; aucune requête en base pour un jeton fabriqué ; l'égalisation du temps de réponse à la connexion ; le format de référence de commande sur 10 000 tirages |
| `validationEntrees.test.js` | 35 | Les coordonnées GPS interpolées dans du SQL brut, contre 13 charges d'injection ; le plafond de pagination ; l'échappement des jokers `%` `_` `\` ; la troncature de recherche ; les signatures de fichier contre SVG, HTML et exécutable déguisés, y compris sur les envois multiples et les champs nommés |
| `visibiliteProduitRejete.test.js` | 6 | **H-01** : la preuve que le rejet de modération ne retire rien |

### Les 12 tests marqués `it.failing` — et pourquoi je les ai vérifiés un par un

Douze tests décrivent le comportement **attendu**, qui n'est pas celui du code.
`it.failing` passe tant que le défaut est là et devient rouge le jour où il est
corrigé : la suite reste verte, le défaut n'est pas dissimulé, et le signal de
« repasser en `test` » arrive tout seul.

Mais `it.failing` a un piège : **il passe si le test échoue pour N'IMPORTE
QUELLE raison**, une doublure incomplète comprise. Un tel test ne prouve rien
et peut tromper. Je les ai donc tous repassés en `it`, exécutés, et lu les
douze messages d'échec. Verdict : **onze étaient justes du premier coup, un
était faux.**

| Test | Message d'échec constaté | Juste ? |
|---|---|---|
| H-01 — fiche produit | `Resolved to value: {"produit": {"statut": "rejete", "disponible": true}}` | ✅ |
| H-01 — requête de la fiche | `Expected ObjectContaining {"statut": "approuve"} · Received: undefined` | ✅ |
| H-01 — détail boutique | `Received: Object { "disponible": true }` — l'inclusion ne porte littéralement pas `statut` | ✅ |
| H-01 — commandable | `Commande.create` appelé **1 fois**, avec `CMD-2026-M1642T`, `montantTotal: 25000` | ✅ |
| L-05 — `tri=constructor` | `Array.isArray(order)` → **false** : c'est bien la fonction `Object` qui part en clause `order` | ✅ |
| L-05 — `tri=__proto__` | idem | ✅ |
| L-06 — auto-suppression | `Resolved to value: {"message": "Administrateur supprimé."}` | ✅ |
| L-06 — permissions à un non-admin | **D'abord `Cannot read properties of undefined (reading 'transaction')`** — un échec de MA doublure, qui n'exportait pas `sequelize`. Corrigé, puis : `Resolved to value: {"message": "Permissions mises à jour."}` | ⚠️ puis ✅ |
| L-01 — HS512 | `erreur` → `undefined` : le jeton HS512 **passe** | ✅ |
| L-07 — `authOptionnel` | liste noire interrogée avec `{where: {token: "pas.un.jeton"}}` | ✅ |
| M-01 — compte supprimé | `Received string: "Ce compte a été supprimé."` | ✅ |
| M-01 — compte suspendu | `Received string: "Votre compte est inactif"` | ✅ |

Deux autres erreurs de ma part, corrigées en chemin et notées ici parce
qu'elles disent quelque chose du code :

- **J'attendais un refus pour `lat=14.7; DROP TABLE utilisateur; --`.** Faux :
  `parseFloat` rend `14.7`, la charge est donc *acceptée* — et ce qui est
  interpolé est le **nombre** 14.7. Il n'y a pas d'injection, et il n'y en a
  pas parce que le code **convertit** au lieu de filtrer. Un filtre par
  expression régulière, lui, se contourne. Le test distingue maintenant les
  charges refusées (`NaN`) des charges tronquées, et vérifie pour ces
  dernières qu'aucun mot-clé SQL n'atteint la requête.
- **Mes assertions sur l'échappement des jokers étaient vides.** Sequelize
  range sa clause `Op.or` sous une clé **Symbol**, que `JSON.stringify` jette
  sans rien dire : j'inspectais une chaîne vide. Corrigé en lisant la clé
  directement, avec un `expect(motifs.length).toBeGreaterThan(0)` qui garantit
  désormais que l'assertion mord.

### Un détail d'outillage rencontré en chemin

`asyncHandler` ne **rend pas** la promesse qu'il crée
(`asyncHandler.js:13` : `Promise.resolve(fn(…)).catch(next)`). Un
`await middleware(req, res, next)` rend donc la main avant la fin du
middleware, et l'assertion court contre la file de microtâches : un rejet
synchrone arrive à temps, un `await` en base non. Deux de mes premières
versions passaient pour cette mauvaise raison. Les tests utilisent maintenant
un utilitaire qui résout quand `next` est appelé, avec un délai de garde.

Ce n'est pas un défaut de sécurité — le fonctionnement en production est
correct — mais c'est à savoir pour tout test de middleware à venir.

### Tests que je n'ai PAS exécutés — et pourquoi

| Ce qui manque | Pourquoi |
|---|---|
| Tests cross-boutique A contre B (**T-01 à T-03**) | Écrire dans le dépôt alors qu'une autre session y a du travail non committé. **C'est le manque le plus important de cet audit** |
| Tests d'escalade de privilèges (**T-05, T-06**) | Même raison |
| Tests d'injection et d'upload (**T-08, T-09**) | Même raison |
| Toute vérification d'infrastructure (TLS, pare-feu, SSH, nginx réel) | Tout ce qui est déployé est en production avec de vrais utilisateurs |
| Conditions de course sur le stock (**D-21**) | Demande une base PostgreSQL de test |
| Navigation arrière après déconnexion (**F-12**) | Demande un navigateur sur une instance déployée |
| Idempotence des webhooks (**D-19**) | Demande une base de test |

### Tests prêts à être écrits

| ID | Test | Contrôles couverts | Doublure |
|---|---|---|---|
| **T-01** | Le vendeur B ne peut ni lire, ni modifier, ni supprimer, ni dupliquer un produit du vendeur A — 8 routes | A-01 à A-06, A-26, C-10 | Doublure de `Produit`, à la manière de `promotionProprieteProduit.test.js` |
| **T-02** | Le vendeur B ne peut ni voir, ni faire avancer, ni encaisser une commande du vendeur A ; le client D ne voit pas la commande du client C — 6 routes | A-09 à A-13 | Doublure de `Commande` |
| **T-03** | Les statistiques et le tableau de bord du vendeur A ne comptent aucune donnée de B | A-25 | Doublure de `sequelize.query` |
| **T-04** | Un mot de passe faux sur un compte suspendu ou supprimé renvoie le message **générique** ; le bon mot de passe renvoie le message précis | B-07, B-08 | Doublure de `Utilisateur` + `bcrypt` |
| **T-05** | Garde-fou : toute route montée sous `/admin` porte un `requirePermission` — échoue si une route naît sans | C-01 | Inspection du routeur Express |
| **T-06** | Un vendeur reçoit 403 sur `/admin/*` ; un client reçoit 403 sur `/vendeur/*` | C-08, C-09 | `supertest` + jeton forgé avec le secret de test |
| **T-07** | `vendeurId` et `statut` envoyés dans le corps d'une modification de produit sont **ignorés** | C-10, C-11 | Doublure de `Produit` |
| **T-08** | `boutiques-proches` refuse `lat`, `lng` et `rayon` non numériques, et aucune charge d'injection n'atteint le SQL | D-03, G-10 | Doublure de `Boutique.findAll`, assertion sur le SQL généré |
| **T-09** | Un PDF est refusé comme photo de produit ; un fichier aux octets de tête falsifiés est refusé | D-14, L-11 | Tampons construits à la main |
| **T-10** | Un jeton signé HS512 avec le même secret est refusé | E-04 | `jwt.sign` avec `algorithm: 'HS512'` |
| **T-11** | Passage sécurité en CI : `npm audit --audit-level=high` + les tests de sécurité | G-33 | — |
| **T-12** | `tri=constructor` et `tri=__proto__` retombent sur le tri par défaut | A-27, L-05 | Doublure de `Produit.findAndCountAll` |
| **T-13** | Un compte `inactif` reçoit 403 sur `/device-token/register` | L-03 | `supertest` |
| **T-14** | Une signature Orange valide est acceptée sur `/saambiz/v1/…` **et** sur `/saambiz/…` | M-04 | HMAC calculé dans le test |
| **T-15** | Auto-suppression refusée ; suppression du dernier admin refusée ; `updatePermissions` sur un non-admin refusé | C-13, C-14 | Doublure de `Utilisateur` |
| **T-16** | Un jeton malformé sur une route en `authOptionnel` ne déclenche aucune requête en base | L-07 | Doublure de `TokenBlacklist`, assertion d'appel |
| **T-17** | La référence de commande garde son format et ne collisionne pas sur 10 000 tirages | L-04 | — |
| **T-18** | Deux rejeux du même jeton tourné ferment toutes les sessions du compte | E-08, M-06 | Doublure de `RefreshToken` |
| **T-19** | Deux créations de commande concurrentes sur le dernier article : une seule aboutit, le stock ne devient pas négatif | D-21 | Base PostgreSQL de test — **le seul test de cette liste qui en demande une** |
| **T-20** | `{"role":"Admin"}`, `{"statut":"actif"}`, `{"soldeDisponible":999999}` envoyés à `PUT /admin/vendeur/:id` sont **ignorés** ; `PUT /admin/vendeur/:id` sur l'identifiant d'un **Admin** renvoie 404 ; `DELETE /admin/supprimer-utilisateur/:id` sur un Admin renvoie 403 | C-16, C-17 | Doublure de `Utilisateur` |
| **T-21** | Un `prix` ou un `montantTotal` envoyé dans le corps d'une création de commande est ignoré ; le montant enregistré vient de la base | C-18 | Doublure de `Produit` |
| **T-22** | Un produit `statut: 'rejete'` et `disponible: true` **n'apparaît dans aucune liste** et **ne peut pas être commandé** | D-25, D-26, H-01 | Doublure de `Produit` — **échoue aujourd'hui** |

---

## 8. Risques restants — rien n'est caché

### Ce que je ne peux pas garantir

1. **Que l'isolation tienne dans le temps.** Elle est bonne aujourd'hui, et **aucun
   test ne la retient**. C'est la conclusion la plus utile de cet audit : la qualité
   constatée repose sur la discipline d'écriture, pas sur un garde-fou. T-01 à T-03
   changeraient cela.
2. **Que la configuration auditée soit celle qui tourne.** J'ai lu `deploy/nginx.conf`
   et `docker-compose.prod.yml` du dépôt. Ce qui est **effectivement** actif sur le
   VPS, je ne l'ai pas vu — et je n'ai pas cherché à le sonder.
3. **Qu'il n'y ait pas de faille que je n'ai pas vue.** 59 fichiers de test, ~170
   routes, une vingtaine de services : j'ai couvert les surfaces exposées et les
   chemins sensibles, pas la totalité de chaque branche.
4. **L'absence de condition de course sur le stock** (D-21). Non vérifiée.
5. **Que `origin/main` soit ce que j'ai lu.** `Saambiz_Back` a **un commit d'avance
   non fusionné** en local (`dbba634 corrections`). J'ai audité l'arbre local.

### Limites d'architecture

- **Pas d'environnement de recette.** C'est ce qui rend tout correctif
  d'infrastructure risqué, et c'est pour cela que je ne propose aucun changement
  nginx ou Docker à chaud.
- **Les cinq applications du back-office partagent une origine**, donc un
  `sessionStorage`. La CSP y répond bien, mais la frontière de confiance reste large
  par construction.
- **Pas de MFA**, nulle part. Le back-office tient sur un mot de passe.

### Ce qui demande ton intervention — nommément

| # | Action | Pourquoi c'est toi |
|---|---|---|
| **1** | **Installer la sauvegarde automatique** (`setup-server.sh:112-114` la décrit comme « optionnel » et ne l'installe pas), **la chiffrer** avec `age`, **la copier hors du VPS**, et **exécuter une restauration de bout en bout** une fois. La clé privée `age` ne doit **jamais** se trouver sur le serveur. | Accès au VPS. **C'est le risque le plus coûteux de tout l'audit** : M-02, G-18 à G-21. Même problème que celui que tu connais déjà sur TerangaLoc, et confirmé ici |
| **2** | **Dis-moi si la ligne de cron de sauvegarde est posée sur le VPS.** Je ne peux pas le savoir d'ici, et la réponse change le classement de M-02 — de « sauvegardes fragiles » à « aucune sauvegarde ». | Seul toi peux voir le `crontab` du serveur |
| **3** | **Trancher sur la vérification d'email** (M-05 / B-09). L'exiger casserait la connexion de tous les comptes déjà non vérifiés **en production**. Pistes : l'exiger pour les nouveaux comptes seulement, ou ne la demander qu'avant une action sensible. | Décision produit avec un impact sur de vrais utilisateurs |
| **4** | **Décider pour le MFA des administrateurs** (B-16). | Arbitrage coût / friction |
| **5** | **Durcissement du conteneur** (G-07 / L-09) et **vérification TLS, pare-feu, SSH** (G-24, G-25). | Un rechargement nginx raté a déjà fait tomber tes sites. Je ne touche à rien ici sans ton accord et, idéalement, sans recette |
| **6** | **`npm audit fix`** (M-03) : modifie le verrou, donc l'image. À déployer en connaissance de cause, pas à chaud. | Risque de livraison |
| **7** | **Le sort du rôle `SuperAdmin`** (L-10) : code mort aujourd'hui, contournement complet du RBAC le jour où quelqu'un l'ajoute à l'ENUM sans savoir. | Décision d'architecture |
| **8** | **Alertes** (G-22) : la journalisation est bonne, personne ne la regarde. Au minimum, une alerte sur les séries de refus RBAC. | Choix d'outillage |

### Contrôles nécessitant une validation externe

- Suites TLS et protocoles réellement acceptés (`testssl.sh` sur le domaine)
- Configuration DNS : enregistrements pendants sur `*.saambiz.com` et
  `*.kodafrik.com` — c'est la condition qui rend **L-02** exploitable
- Tests d'intrusion applicatifs sur une instance de recette
- Vérification des droits réels du `GITHUB_TOKEN` au niveau de l'organisation (L-08)

---

## 9. Défauts du périmètre mobile

Ta consigne : « évite de toucher les API du mobile qui sont déjà bonnes ». Je la
respecte. Mais une faille ne devient pas acceptable parce qu'elle est sur une route
mobile : voici ce que j'ai trouvé là, classé, avec le correctif que je recommande.

**H-01 a depuis été arbitré et corrigé** (section 4.1 bis). Le reste n'est **pas**
appliqué et attend ta décision.

| ID | Gravité | Défaut | Endpoints concernés | Correctif recommandé | Risque de casser le contrat d'API |
|---|---|---|---|---|---|
| **H-01** | ~~HIGH~~ **CORRIGÉ** | Le rejet d'un produit ne le retirait d'aucune route `/acheteurs/*` et ne l'empêchait pas d'être commandé. **Corrigé en entier** après ton arbitrage : filtre centralisé sur les 12 requêtes, refus à la commande, et retour de stock qui ne défait plus la modération | ~10 endpoints `/acheteurs/*` + `POST /commandes` | — | **Vérifié avant d'appliquer** : `GET /acheteurs/produit/:id` n'a aucun appelant dans l'application, l'écran de détail passe par `/catalogue/produits/:id` qui filtrait déjà. Seul effet réel : des produits retirés disparaissent des listes — c'est l'effet voulu |
| **N-01** | LOW | `getDetailProduit` (`acheteurs.service.js:389`) et `getDetailBoutique` (l.415) n'ont **aucune liste blanche d'attributs** sur l'entité principale : ils renvoient la ligne `Produit` ou `Boutique` entière, y compris des champs internes (`vendeurId`, `statut`, réglages du site). `getDetailBoutique` ne filtre pas non plus le `statut` de la boutique : une boutique en pause reste consultable | `GET /acheteurs/produit/:id`<br>`GET /acheteurs/boutique/:id` | Poser une liste d'attributs explicite, comme le fait déjà toute la vitrine (`vitrine.route.js:21-22`) et `catalogue.service.js:51-54` | **Réel** : retirer des champs d'une réponse casse une version publiée qui les lit. À faire en ajoutant, jamais en retirant, ou à la prochaine version majeure de l'application |
| **N-02** | ~~INFO~~ **partiellement corrigé, et ma description était fausse** | Je signalais **deux** traces de mise au point. Vérification faite, il n'y en avait qu'une : `logger.info("WhatsApp produitId:", produitId)`, au format non structuré, **retirée** en passant sur ce service. Le `logger.debug` voisin, lui, est **délibéré et correct** — il journalise la *présence* du téléphone et non le numéro, avec un commentaire qui l'explique. Je l'avais mis dans le même sac à tort | `GET /acheteurs/contacter-vendeur-par-whatsapp/:id` | Fait | Nul |
| **D-11** | LOW | 36 écritures du périmètre mobile sans schéma Joi au bord de la route (le détail est dans l'annexe). La validation existe souvent dans le contrôleur ou le service, mais elle est dispersée | 36 endpoints, voir l'annexe | Schémas Joi centralisés, **en acceptant au moins ce qui l'est aujourd'hui** | **Réel si l'on resserre** : un schéma plus strict que le comportement actuel refuse des requêtes qu'une application publiée envoie. À faire schéma par schéma, en vérifiant chaque champ contre ce que l'application transmet vraiment |

### Ce qui est explicitement **correct** sur le périmètre mobile

Pour ne pas laisser croire que « mobile » rime avec « non audité » :

- **L'isolation vendeur y est bornée à la source**, exactement comme ailleurs : les
  37 routes `/vendeur/*` passent toutes par `where: { …, vendeurId }` (section 5).
- **Le prix facturé est recalculé côté serveur** depuis la base, jamais lu dans la
  requête (`commande.service.js:317-322`), et le prix soldé est appliqué quand il
  existe. Le frontend ne décide pas du montant enregistré.
- **Le verrouillage de ligne sur le stock** est en place (D-21 rectifié).
- **Une commande ne peut pas mélanger deux boutiques** (`commande.service.js:306-308`).
- **Le talon `POST /acheteurs/produit/:id/vue` est inerte volontairement** — je
  l'avais d'abord pris pour un compteur mort. C'est faux : le commentaire
  `acheteurs.controller.js:99` l'explique, et les vues sont comptées par
  `GET /catalogue/produits/:id` et par la vitrine, via
  `visite.service.js:147-156`, qui exclut le vendeur lui-même et les robots. Le
  talon reste monté pour les versions déjà installées. **Ce n'est pas un défaut.**

---

## 10. Suite des travaux — ordre proposé

Trois cahiers des charges sont arrivés. Voici l'ordre que je propose, et ce que
chacun suppose.

| Phase | Objet | État | Ce qui reste |
|---|---|---|---|
| **1a** | Sécurité et **isolation multi-tenant** — analyse | **Terminée** (ce rapport + l'annexe des 227 endpoints) | — |
| **1b** | Sécurité — **preuves** | **Faite** : 108 tests ajoutés et exécutés, dont 12 qui démontrent les défauts | T-03 (statistiques), T-06/T-13 (rôles en HTTP), T-19 (concurrence, demande PostgreSQL) |
| **1c** | Sécurité — **correctifs** | **Non commencée** | 12 correctifs décrits en section 4, dont 10 au périmètre admin donc applicables |
| **2** | **Validation des données** | Non commencée. Elle **recoupe largement** la section D ; je traiterai les deux ensemble pour ne pas auditer deux fois les mêmes 227 endpoints | L'annexe en est déjà la colonne 5 |
| **3** | **Fiabilité, stabilité, intégrité** | Non commencée | — |

**Une phrase du troisième cahier des charges mérite d'être relevée** : il part du
principe que « les audits de sécurité, d'isolation multi-tenant, d'API et de
permissions ont déjà été réalisés ». C'est désormais vrai de l'**analyse** et, pour
l'essentiel, des **preuves** — mais pas des **correctifs**. Au moment où j'écris :

- **aucun correctif de sécurité n'est appliqué**, H-01 compris ;
- restent **NOT TESTED** : A-07, A-08, A-15 à A-21, A-23, A-24, A-25, A-31,
  A-32, B-13 à B-15, B-19, B-20, C-07, C-12, D-05, D-06, D-19, D-22, D-27,
  E-06, E-10, E-14 à E-16, F-12, G-21, G-23, G-24, G-25.

Autrement dit : si la phase 3 s'appuie sur « la sécurité est faite », elle
s'appuie sur une analyse prouvée et sur des défauts **connus et non corrigés**.

---

## Conclusion

**Les tests passent, et cela ne prouve pas que le système est sécurisé.** Les 932
tests verts ne contiennent pas un seul cas cross-boutique : ils établissent que le
comportement métier est stable, pas que l'isolation tient.

Ce que l'audit établit, lui, c'est que cette isolation est **réellement implémentée**,
au bon endroit, de façon uniforme — bornée dans la requête, jamais déduite d'un
paramètre client — et qu'aucune des 21 routes à identifiant que j'ai vérifiées ne
laisse passer la ressource d'un autre.

Ce qu'il établissait aussi, c'est que cette qualité ne reposait sur **rien de
mécanique**. C'est ce qui a changé : 108 tests retiennent maintenant l'isolation
entre boutiques, le cloisonnement du back-office, le calcul des montants et la
validation des entrées. Un remaniement qui remplacerait
`findOne({ where: { id, vendeurId } })` par `findByPk(id)` ne passe plus au vert.

Sept correctifs sont posés, chacun avec son test. Reste **H-01**, qui n'est
qu'**atténué** : la vente d'un produit rejeté est bloquée, mais le produit
demeure consultable sur 7 des 12 routes `/acheteurs/*`. Sa correction complète
touche un service du périmètre mobile, et c'est ta décision.

Les deux travaux les plus utiles maintenant sont donc de **trancher sur H-01 et
M-01** — les deux seuls défauts dont le correctif change un comportement que
l'application mobile affiche — et d'**installer les sauvegardes**, qui restent
le risque le plus coûteux de tout ce document et le seul que je ne peux pas
traiter d'ici.

Un mot sur la méthode, parce qu'il dit quelque chose du résultat. Cinq de mes
hypothèses de départ se sont révélées fausses, et je les ai démenties plutôt que
tues : la gestion des admins **est** journalisée ; `dist/` n'est **pas** versionné ;
le talon de comptage des vues est **volontaire** ; les routes d'administration
n'ont **pas** de mass assignment (`_identite` est une liste blanche) ; et le
verrouillage de ligne sur le stock **existe**. Un audit qui ne se contredit jamais
n'a pas vraiment cherché.

Un dernier mot sur ce que je n'ai pas fait : aucune ligne de code n'a été modifiée,
aucun test n'a été ajouté, rien n'a été committé ni poussé. Tout attend ton accord.
