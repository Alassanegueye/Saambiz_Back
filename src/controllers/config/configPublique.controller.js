const ConfigService = require('../../services/config/config.service');
const logger = require('../../utils/logger');

/**
 * Réglages publics — lus sans compte par l'application mobile et les sites.
 *
 * Ces deux routes vivaient directement dans app.js, avec leur `require` du
 * service à l'intérieur du gestionnaire. Elles suivent désormais le même
 * chemin que les autres : route → contrôleur → service.
 *
 * Particularité conservée : en cas d'échec, on répond 200 avec des valeurs
 * par défaut au lieu d'une erreur. Une base momentanément indisponible ne
 * doit ni bloquer l'ouverture de l'application (écran de mise à jour forcée
 * déclenché à tort) ni masquer le prix sur la page d'abonnement. On journalise
 * quand même, pour que la panne ne passe pas inaperçue.
 */

exports.getPrixAbonnement = async (req, res) => {
  try {
    const prix = await ConfigService.getPrixAbonnement();
    return res.status(200).json({ prix, devise: 'FCFA' });
  } catch (err) {
    logger.warn('config_publique:prix_abonnement_par_defaut', { message: err.message });
    return res.status(200).json({ prix: 2000, devise: 'FCFA' });
  }
};

exports.getConfigApplication = async (req, res) => {
  try {
    const config = await ConfigService.getConfigApplicationMobile();
    // Cache HTTP court : la réponse est identique pour tout le monde et
    // l'application l'interroge à chaque démarrage.
    res.set('Cache-Control', 'public, max-age=60');
    return res.status(200).json(config);
  } catch (err) {
    logger.warn('config_publique:app_config_par_defaut', { message: err.message });
    return res.status(200).json({
      minVersionAndroid: '1.0.0',
      minVersionIos: '1.0.0',
      maintenance: false,
      message: null,
    });
  }
};
