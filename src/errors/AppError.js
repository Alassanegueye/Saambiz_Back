/**
 * Erreurs applicatives typées.
 *
 * Avant cette hiérarchie, chaque service signalait ses échecs par un objet
 * `{ success: false, error }` que chaque contrôleur retraduisait à la main en
 * code HTTP. Le même cas métier — « boutique introuvable » — sortait en 404
 * sur une route et en 500 sur une autre, selon qui avait écrit le contrôleur.
 *
 * Le drapeau `isOperational` distingue ce qu'on a prévu (un identifiant qui
 * n'existe pas) de ce qu'on n'a pas prévu (une colonne manquante). Le premier
 * s'affiche à l'utilisateur, le second est masqué en production et remonté
 * dans les journaux.
 */
class AppError extends Error {
  /**
   * @param {string} message  Destiné à l'utilisateur : en français, sans jargon.
   * @param {number} status   Code HTTP.
   * @param {object} [options]
   * @param {Array}  [options.details]  Précisions par champ (validation).
   * @param {string} [options.code]     Code applicatif stable pour les clients.
   */
  constructor(message, status = 500, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.isOperational = true;
    if (options.details) this.details = options.details;
    if (options.code) this.code = options.code;

    Error.captureStackTrace(this, this.constructor);
  }
}

/** 400 — la requête est mal formée ou incohérente. */
class BadRequestError extends AppError {
  constructor(message = 'Requête invalide.', options = {}) {
    super(message, 400, options);
  }
}

/** 401 — identité absente ou non prouvée. */
class UnauthorizedError extends AppError {
  constructor(message = 'Authentification requise.', options = {}) {
    super(message, 401, options);
  }
}

/** 403 — identité connue, mais droits insuffisants. */
class ForbiddenError extends AppError {
  constructor(message = "Vous n'avez pas les droits nécessaires.", options = {}) {
    super(message, 403, options);
  }
}

/** 404 — la ressource n'existe pas, ou n'est pas visible par cet appelant. */
class NotFoundError extends AppError {
  constructor(message = 'Ressource introuvable.', options = {}) {
    super(message, 404, options);
  }
}

/** 409 — l'état actuel interdit l'opération (doublon, transition impossible). */
class ConflictError extends AppError {
  constructor(message = 'Cette opération entre en conflit avec l\'état actuel.', options = {}) {
    super(message, 409, options);
  }
}

/**
 * 422 — la requête est bien formée mais son contenu est refusé.
 * `details` porte le détail champ par champ, que les formulaires affichent.
 */
class ValidationError extends AppError {
  constructor(message = 'Certaines informations sont invalides.', details = [], options = {}) {
    super(message, 422, { ...options, details });
  }
}

/**
 * 429 — trop de demandes rapprochées.
 *
 * Distinct du limiteur de débit global, qui compte les requêtes par adresse :
 * celui-ci exprime une règle métier. On ne redemande pas un code de
 * vérification toutes les deux secondes, sinon la route devient un moyen
 * d'inonder une boîte mail qu'on ne possède pas.
 */
class TooManyRequestsError extends AppError {
  constructor(message = 'Trop de demandes rapprochées. Patientez un instant.', options = {}) {
    super(message, 429, options);
  }
}

/** 503 — dépendance externe indisponible (base, passerelle de paiement). */
class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporairement indisponible.', options = {}) {
    super(message, 503, options);
  }
}

module.exports = {
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  TooManyRequestsError,
  ServiceUnavailableError,
};
