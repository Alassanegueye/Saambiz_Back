// Applique les migrations SQL du dossier `migrations/`, dans l'ordre des noms
// de fichiers (préfixés par une date : 20260703_… puis 20260901_…).
//
// Pourquoi ce script existe : `sequelize.sync({ force: false })` crée les
// tables MANQUANTES mais n'ajoute jamais une colonne à une table existante.
// Sur un volume qui contient déjà des données, les nouvelles colonnes
// (statut_validation, piece_identite…) n'apparaîtraient donc jamais et l'API
// planterait à la première requête. Les migrations comblent ce trou.
//
// Chaque fichier n'est appliqué qu'une fois : les noms déjà passés sont
// consignés dans la table `migration_appliquee`. Les fichiers restent malgré
// tout écrits pour être rejouables sans dégât (IF NOT EXISTS partout).

const fs = require('fs');
const path = require('path');
const sequelize = require('../config/db');
const logger = require('../utils/logger');

const DOSSIER = path.join(__dirname, '..', '..', 'migrations');

async function creerTableSuivi() {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS migration_appliquee (
      nom        VARCHAR(255) PRIMARY KEY,
      appliquee_le TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function dejaAppliquees() {
  const [lignes] = await sequelize.query('SELECT nom FROM migration_appliquee');
  return new Set(lignes.map((l) => l.nom));
}

async function migrate() {
  if (!fs.existsSync(DOSSIER)) {
    logger.info('[migrate] Aucun dossier migrations — rien à appliquer');
    return 0;
  }

  await creerTableSuivi();
  const passees = await dejaAppliquees();

  const fichiers = fs
    .readdirSync(DOSSIER)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let appliquees = 0;
  for (const fichier of fichiers) {
    if (passees.has(fichier)) continue;

    const sql = fs.readFileSync(path.join(DOSSIER, fichier), 'utf8');
    try {
      // Les fichiers portent leur propre BEGIN/COMMIT : on les exécute tels
      // quels plutôt que dans une transaction Sequelize qui entrerait en
      // conflit avec (CREATE TYPE ne supporte pas toujours l'imbrication).
      await sequelize.query(sql);
      await sequelize.query(
        'INSERT INTO migration_appliquee (nom) VALUES (:nom) ON CONFLICT DO NOTHING',
        { replacements: { nom: fichier } }
      );
      appliquees++;
      logger.info(`[migrate] ${fichier} appliquée`);
    } catch (err) {
      logger.error(`[migrate] Échec sur ${fichier}`, { message: err.message });
      throw err;
    }
  }

  if (appliquees === 0) {
    logger.info(`[migrate] Base à jour (${fichiers.length} migration(s) déjà passée(s))`);
  }
  return appliquees;
}

module.exports = migrate;

// Exécution directe : `npm run migrate`
if (require.main === module) {
  require('dotenv').config();
  (async () => {
    try {
      await sequelize.authenticate();
      const n = await migrate();
      logger.info(`[migrate] Terminé — ${n} migration(s) appliquée(s)`);
      await sequelize.close();
      process.exit(0);
    } catch (err) {
      logger.error('[migrate] Échec', { message: err.message });
      process.exit(1);
    }
  })();
}
