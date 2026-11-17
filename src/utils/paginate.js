/**
 * Pagination normalisée.
 *
 * La borne haute est le point important : sans elle, `?limit=100000` fait
 * charger toute une table en mémoire, sérialiser le résultat et l'envoyer.
 * C'est un déni de service à une requête, disponible pour n'importe qui.
 */
// Dix par page : la taille demandee pour toute l'application, et celle que
// les boutons « Precedent / Suivant » du mobile supposent. Un ecran de
// telephone en montre entre trois et six sans defiler.
const LIMITE_DEFAUT = 10;
const LIMITE_MAX = 100;

/**
 * @returns {{ page: number, limit: number, offset: number }}
 */
function paginate(page = 1, limit = LIMITE_DEFAUT) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(LIMITE_MAX, Math.max(1, parseInt(limit, 10) || LIMITE_DEFAUT));

  return { page: p, limit: l, offset: (p - 1) * l };
}

/** Métadonnées à joindre à une liste paginée. */
function metaPagination(total, page, limit) {
  return {
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}

module.exports = { paginate, metaPagination, LIMITE_DEFAUT, LIMITE_MAX };
