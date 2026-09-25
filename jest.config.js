/** Configuration Jest — voir tests/README.md pour la répartition. */
module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/setup.js'],
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  // `uuid` 11 est un module ESM que Jest ne peut pas charger en CommonJS, et
  // Sequelize l'appelle en `require`. Sans ce renvoi, tout test qui importe un
  // modèle ou `src/app.js` échoue au chargement. Voir tests/shims/uuid.cjs.
  moduleNameMapper: {
    '^uuid$': '<rootDir>/tests/shims/uuid.cjs',
  },
  collectCoverageFrom: [
    'src/config/security.js',
    'src/errors/**/*.js',
    'src/middlewares/**/*.js',
    'src/utils/**/*.js',
    'src/validators/**/*.js',
  ],
  // Les tests d'intégration ouvrent une connexion PostgreSQL : sans ce délai,
  // le premier test échoue sur une machine froide.
  testTimeout: 15000,
};
