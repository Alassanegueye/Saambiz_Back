/**
 * Remplaçant CommonJS du paquet `uuid`, uniquement pour les tests.
 *
 * `uuid` 11 est publié en ESM pur (l'override du package.json l'impose pour
 * une correction de sécurité) et Sequelize l'appelle en `require('uuid')`.
 * Jest ne sait pas charger cet ESM depuis un contexte CommonJS : sans ce
 * remplaçant, importer un modèle — donc `src/app.js` — fait échouer toute la
 * suite avant le premier test.
 *
 * Sequelize ne s'en sert que pour engendrer des identifiants ; `randomUUID`
 * de Node fait le travail. La v1 (horodatée) est approximée par une v4 : rien
 * dans le projet ne dépend de l'ordre temporel des UUID.
 */
const { randomUUID } = require('node:crypto');

const v4 = () => randomUUID();

module.exports = { v1: v4, v4, validate: (s) => typeof s === 'string' && s.length === 36 };
