/**
 * Les migrations ne parlent qu'à des tables qui existent.
 *
 * Toutes les tables de ce schéma sont au SINGULIER — `commande`, `boutique`,
 * `produit`, `utilisateur` — parce que les modèles portent
 * `freezeTableName: true`. Une migration écrite au pluriel ne rate pas
 * discrètement : `bootstrap.js` applique les migrations au démarrage et
 * refuse de lancer le serveur si l'une échoue. Le conteneur redémarre alors
 * en boucle, et le déploiement s'arrête au bout de cinq minutes sur
 * « relation "commandes" does not exist ». C'est arrivé.
 *
 * Ce test lit le SQL au lieu de la base : il tourne sans PostgreSQL, et il
 * attrape la faute avant le serveur.
 */
const fs = require('fs');
const path = require('path');

const DOSSIER_MIGRATIONS = path.join(__dirname, '..', '..', 'migrations');
const DOSSIER_MODELES = path.join(__dirname, '..', '..', 'src', 'models');

/** Les `tableName:` déclarés par les modèles Sequelize. */
function tablesDesModeles() {
  const tables = new Set();
  for (const fichier of fs.readdirSync(DOSSIER_MODELES)) {
    if (!fichier.endsWith('.model.js')) continue;
    const source = fs.readFileSync(path.join(DOSSIER_MODELES, fichier), 'utf8');
    for (const m of source.matchAll(/tableName:\s*'([a-z_0-9]+)'/g)) tables.add(m[1]);
  }
  return tables;
}

/** `CREATE TABLE x`, avec ou sans IF NOT EXISTS, TEMP, TEMPORARY, UNLOGGED. */
const CREATION_TABLE = /CREATE\s+(?:TEMP(?:ORARY)?\s+|UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_0-9]+)"?/gi;

const fichiersMigrations = fs
  .readdirSync(DOSSIER_MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort();

/** Le SQL, débarrassé de ses commentaires : la prose parle au pluriel. */
function sqlSansCommentaires(fichier) {
  return fs
    .readFileSync(path.join(DOSSIER_MIGRATIONS, fichier), 'utf8')
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Tables créées par les migrations elles-mêmes (certaines n'ont pas de modèle). */
function tablesCreees() {
  const tables = new Set();
  for (const fichier of fichiersMigrations) {
    const sql = sqlSansCommentaires(fichier);
    // `TEMP` inclus : 20261019_structure_categories.sql s'appuie sur une
    // table temporaire, qui existe le temps de la transaction.
    for (const m of sql.matchAll(CREATION_TABLE)) tables.add(m[1].toLowerCase());
  }
  return tables;
}

/** Toutes les tables citées par une migration, et comment. */
function tablesCitees(sql) {
  const citations = [];
  const motifs = [
    [/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?([a-z_0-9]+)"?/gi, 'ALTER TABLE'],
    [CREATION_TABLE, 'CREATE TABLE'],
    [/REFERENCES\s+"?([a-z_0-9]+)"?\s*\(/gi, 'REFERENCES'],
    [/INSERT\s+INTO\s+"?([a-z_0-9]+)"?/gi, 'INSERT INTO'],
    [/UPDATE\s+"?([a-z_0-9]+)"?\s+SET/gi, 'UPDATE'],
    [/DELETE\s+FROM\s+"?([a-z_0-9]+)"?/gi, 'DELETE FROM'],
    // `CREATE INDEX … ON table (…)`, en laissant de côté `ON DELETE CASCADE`
    // et `ON CONFLICT`, qui ne sont pas des noms de tables.
    [/CREATE\s+(?:UNIQUE\s+)?INDEX[\s\S]*?\sON\s+"?([a-z_0-9]+)"?\s*\(/gi, 'CREATE INDEX'],
  ];
  for (const [motif, quoi] of motifs) {
    for (const m of sql.matchAll(motif)) {
      citations.push({ table: m[1].toLowerCase(), quoi });
    }
  }
  return citations;
}

describe('Les migrations SQL', () => {
  const connues = new Set([...tablesDesModeles(), ...tablesCreees()]);

  test('il y a bien des modèles et des migrations à vérifier', () => {
    // Si une des deux lectures rendait du vide, tous les tests ci-dessous
    // passeraient sans rien vérifier.
    expect(tablesDesModeles().size).toBeGreaterThan(20);
    expect(fichiersMigrations.length).toBeGreaterThan(10);
  });

  test('la table des commandes est au singulier dans les modèles', () => {
    // La faute de 20261117_demande_annulation.sql, en une ligne : le pluriel
    // n'existe pas, et le serveur refuse alors de démarrer.
    expect(connues.has('commande')).toBe(true);
    expect(connues.has('commandes')).toBe(false);
  });

  test.each(fichiersMigrations)('%s ne cite que des tables existantes', (fichier) => {
    const inconnues = tablesCitees(sqlSansCommentaires(fichier))
      .filter(({ table }) => !connues.has(table))
      .map(({ quoi, table }) => `${quoi} ${table}`);

    expect([...new Set(inconnues)]).toEqual([]);
  });
});
