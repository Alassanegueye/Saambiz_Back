const logger = require('./logger');

/**
 * Le `.catch` d'une action secondaire lancée sans être attendue (notification,
 * e-mail, journal d'audit, statistique) : son échec ne fait jamais échouer
 * l'action principale, mais il laisse un avertissement dans les journaux au
 * lieu de disparaître sans trace.
 *
 *   CommandeService._emailClient(commande, 'recue').catch(echecIgnore('e-mail au client'));
 *   const b = await Boutique.findOne(...).catch(echecIgnore('boutique du vendeur', null));
 *
 * `valeur` remplace le résultat quand l'action échoue (undefined par défaut).
 */
function echecIgnore(action, valeur) {
  return (err) => {
    // Ce gestionnaire ne doit jamais rejeter lui-même : une promesse rejetée
    // que personne n'attend arrête le serveur (`unhandledRejection` dans
    // server.js). Si le journal lui-même est en panne, l'échec reste ignoré.
    try {
      logger.warn(`[échec ignoré] ${action}`, { message: err?.message ?? String(err) });
    } catch {
      // rien de plus à faire
    }
    return valeur;
  };
}

module.exports = echecIgnore;
