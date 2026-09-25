/**
 * Format unique des réponses de l'API.
 *
 * Auparavant, chaque route inventait sa forme : `{ success, message }`,
 * `{ message, data }`, `{ boutique }`, ou l'objet nu. Les clients
 * compensaient par des chaînes de repli du genre
 * `res.data?.produits || res.data?.data || res.data || []`, présentes dans
 * toutes les pages du dashboard vendeur.
 *
 * Succès : { success: true,  message, data }
 * Échec  : { success: false, message, details? }
 */

/** 200 — succès avec charge utile. */
const ok = (res, data = null, message = 'Opération réussie.') =>
  res.status(200).json({ success: true, message, data });

/** 201 — ressource créée. */
const created = (res, data = null, message = 'Ressource créée.') =>
  res.status(201).json({ success: true, message, data });

/** 204 — succès sans contenu (suppression). */
const noContent = (res) => res.status(204).end();

/**
 * Échec attendu. Le statut par défaut est 400 : un échec sans statut est
 * presque toujours une requête invalide, pas une panne serveur.
 */
const fail = (res, message = 'Requête invalide.', status = 400, details = undefined) => {
  const corps = { success: false, message };
  if (details) corps.details = details;
  return res.status(status).json(corps);
};

/**
 * 500 — panne. Le message d'origine ne sort jamais en production : il expose
 * des noms de tables, des chemins de fichiers, parfois des valeurs.
 */
const serverError = (res, message = 'Erreur serveur interne.') =>
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Erreur serveur interne.' : message,
  });

module.exports = { ok, created, noContent, fail, serverError };
