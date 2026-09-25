const { AppError } = require('../errors/AppError');
const logger = require('../utils/logger');

/**
 * Gestionnaire d'erreurs global — DERNIER middleware monté.
 *
 * Il traduit en réponse HTTP tout ce qui peut remonter jusqu'ici. Le
 * précédent se contentait de lire `err.status` : une contrainte d'unicité
 * violée, un jeton expiré, un fichier trop lourd ou un JSON malformé
 * sortaient tous en 500 « Erreur serveur interne », ce qui rendait le
 * diagnostic impossible côté client comme côté support.
 *
 * Règle de fond : en production, seuls les messages d'erreurs *opérationnelles*
 * sortent. Le reste est masqué — un message Sequelize brut nomme les tables,
 * les colonnes et parfois les valeurs.
 */

const EN_PRODUCTION = process.env.NODE_ENV === 'production';

/** Traduit les erreurs Sequelize en codes HTTP parlants. */
function traduireSequelize(err) {
  switch (err.name) {
    case 'SequelizeValidationError':
      return {
        status: 422,
        message: 'Certaines informations sont invalides.',
        details: err.errors?.map((e) => ({ champ: e.path, message: e.message })),
      };

    case 'SequelizeUniqueConstraintError':
      return {
        status: 409,
        // Le nom du champ suffit à l'utilisateur ; la contrainte SQL ne lui
        // dirait rien et exposerait le schéma.
        message: err.errors?.[0]?.path
          ? `Cette valeur de « ${err.errors[0].path} » est déjà utilisée.`
          : 'Cette valeur existe déjà.',
        details: err.errors?.map((e) => ({ champ: e.path, message: 'Déjà utilisé' })),
      };

    case 'SequelizeForeignKeyConstraintError':
      return {
        status: 400,
        message: 'Référence invalide : un élément lié est introuvable ou encore utilisé.',
      };

    case 'SequelizeDatabaseError':
      // Souvent une valeur d'énumération inconnue ou un type incompatible.
      return { status: 400, message: 'Requête invalide pour la base de données.' };

    case 'SequelizeConnectionError':
    case 'SequelizeConnectionRefusedError':
    case 'SequelizeHostNotFoundError':
    case 'SequelizeConnectionTimedOutError':
      return { status: 503, message: 'Base de données momentanément indisponible.' };

    default:
      return null;
  }
}

/** Traduit les erreurs de jeton. */
function traduireJwt(err) {
  if (err.name === 'TokenExpiredError') {
    return { status: 401, message: 'Session expirée, reconnectez-vous.' };
  }
  if (err.name === 'JsonWebTokenError' || err.name === 'NotBeforeError') {
    return { status: 401, message: 'Jeton invalide.' };
  }
  return null;
}

/** Traduit les erreurs d'upload Multer. */
function traduireMulter(err) {
  if (err.name !== 'MulterError') return null;

  const messages = {
    LIMIT_FILE_SIZE: 'Fichier trop volumineux (5 Mo maximum).',
    LIMIT_FILE_COUNT: 'Trop de fichiers envoyés.',
    LIMIT_UNEXPECTED_FILE: `Champ de fichier inattendu : « ${err.field} ».`,
    LIMIT_PART_COUNT: 'Requête trop fragmentée.',
  };
  return { status: 413, message: messages[err.code] || 'Envoi de fichier refusé.' };
}

// eslint-disable-next-line no-unused-vars -- la signature à 4 arguments est ce
// qui identifie un gestionnaire d'erreurs auprès d'Express.
function errorHandler(err, req, res, next) {
  let status = err.status || err.statusCode;
  let message = err.message;
  let details = err.details;

  // JSON malformé : body-parser lève une SyntaxError porteuse d'un `body`.
  if (err instanceof SyntaxError && 'body' in err) {
    status = 400;
    message = 'Corps de requête JSON malformé.';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'Corps de requête trop volumineux.';
  } else if (!(err instanceof AppError)) {
    const traduit = traduireSequelize(err) || traduireJwt(err) || traduireMulter(err);
    if (traduit) {
      status = traduit.status;
      message = traduit.message;
      details = traduit.details;
    }
  }

  status = status || 500;

  // Les erreurs serveur sont tracées avec leur pile ; les erreurs
  // opérationnelles (400-499) ne polluent pas le niveau `error`, sinon les
  // alertes deviennent inaudibles à force de fautes de frappe utilisateur.
  const journal = {
    requestId: req.requestId,
    status,
    message: err.message,
    name: err.name,
    method: req.method,
    url: req.originalUrl,
    utilisateurId: req.user?.id,
  };
  if (status >= 500) {
    logger.error('erreur_non_geree', { ...journal, stack: EN_PRODUCTION ? undefined : err.stack });
  } else {
    logger.warn('erreur_operationnelle', journal);
  }

  // En production, un message non maîtrisé accompagnant un 500 peut nommer
  // des tables ou des chemins : on le remplace.
  const messageSortant = status >= 500 && EN_PRODUCTION
    ? 'Erreur serveur interne.'
    : (message || 'Erreur serveur interne.');

  const corps = { success: false, message: messageSortant };
  if (details) corps.details = details;
  if (err.code && typeof err.code === 'string') corps.code = err.code;

  return res.status(status).json(corps);
}

module.exports = errorHandler;
