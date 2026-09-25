/**
 * Enveloppe un contrôleur asynchrone pour que ses rejets partent dans le
 * gestionnaire d'erreurs global.
 *
 * Sans elle, chaque contrôleur porte son propre try/catch suivi d'un
 * `res.status(500)`. Un seul oubli et l'erreur devient un
 * `unhandledRejection` : la requête reste ouverte jusqu'au timeout du client,
 * et rien n'apparaît dans les journaux.
 *
 * Usage : router.get('/x', asyncHandler(ctrl.methode));
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
