# Tests

```bash
npm test              # tout
npm run test:coverage # avec couverture
npx jest tests/unitaires   # une seule famille
```

## Répartition

| Dossier | Ce qui est vérifié | Base de données |
|---|---|---|
| `unitaires/` | Configuration de sécurité, erreurs typées, permissions, validation, jetons de rafraîchissement | non |
| `integration/` | Chaîne HTTP complète sur `src/app` : contrôleur → `asyncHandler` → gestionnaire global | non |

Les tests d'intégration actuels visent des routes qui échouent **avant** la
première requête SQL (champ manquant, JSON malformé, jeton absent ou
illisible). Ils tournent donc sans PostgreSQL. Un test qui aurait besoin d'une
vraie base devra démarrer la stack (`docker compose up -d`) — d'où le
`testTimeout` élevé dans `jest.config.js`.

## Deux points à connaître

**`uuid` est un module ESM.** L'override du `package.json` impose `uuid >= 11`,
publié en ESM pur, alors que Sequelize l'appelle en `require('uuid')`. Jest ne
sait pas charger cela depuis un contexte CommonJS : sans le renvoi
`moduleNameMapper` vers `tests/shims/uuid.cjs`, tout test qui importe un modèle
— donc `src/app.js` — échoue au chargement, avant le premier `it()`.

**Les tâches planifiées ne démarrent pas avec `app`.** `startJobs()` est appelé
depuis `src/server.js`, pas depuis `src/app.js`. Tant qu'il vivait dans `app`,
importer l'application dans un test laissait des crons actifs : la suite ne se
terminait jamais.
