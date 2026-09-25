/**
 * Environnement des tests.
 *
 * Les secrets sont posés ici pour que `config/security.js` accepte de se
 * charger : ce module refuse de démarrer sans trois secrets distincts d'au
 * moins 32 caractères — c'est précisément ce qu'on veut vérifier.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_acces_'.padEnd(40, 'a');
process.env.JWT_REFRESH_SECRET = 'test_refresh_'.padEnd(40, 'b');
process.env.JWT_RESET_SECRET = 'test_reset_'.padEnd(40, 'c');
process.env.CORS_ORIGIN = 'http://localhost:5190';
