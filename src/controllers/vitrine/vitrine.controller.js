// controllers/vitrine/vitrine.controller.js
//
// Le site public d'une boutique. Aucune de ces routes n'est authentifiée :
// le visiteur est un client du vendeur, pas un utilisateur de SaamBiz — et
// c'est précisément ce qu'on veut, il n'a rien à installer pour commander.
//
// Les contrôleurs sont enveloppés dans asyncHandler à l'export, comme les
// dix-huit autres du projet : le fichier de routes n'a pas à le savoir.

const VitrineService = require('../../services/vitrine/vitrine.service');
const asyncHandler = require('../../middlewares/asyncHandler');
const { ok, created } = require('../../utils/response');

/** GET /vitrine/:slug — tout ce qu'il faut pour peindre la page d'accueil. */
exports.accueil = asyncHandler(async (req, res) => {
  const data = await VitrineService.accueil(req.params.slug);

  // La visite est comptée sans attendre : le rendu de la page ne dépend pas
  // du compteur, et le service avale déjà ses propres erreurs.
  VitrineService.enregistrerVisite(req.params.slug);

  return ok(res, data, 'Boutique chargée.');
});

/** GET /vitrine/:slug/produits — catalogue paginé, filtré, trié. */
exports.listerProduits = asyncHandler(async (req, res) => {
  const data = await VitrineService.listerProduits(req.params.slug, {
    q: req.query.q,
    categorie: req.query.categorie,
    tri: req.query.tri,
    page: req.query.page,
    limit: req.query.limit,
  });
  return ok(res, data, 'Catalogue chargé.');
});

/** GET /vitrine/:slug/produits/:produitId — fiche produit + similaires. */
exports.getProduit = asyncHandler(async (req, res) => {
  const data = await VitrineService.getProduit(req.params.slug, req.params.produitId);
  return ok(res, data, 'Produit chargé.');
});

/** POST /vitrine/:slug/commande — passage en caisse sans compte. */
exports.creerCommande = asyncHandler(async (req, res) => {
  const data = await VitrineService.creerCommande(req.params.slug, req.body);
  return created(res, data, 'Commande enregistrée.');
});

/**
 * GET /vitrine/commande/:reference?telephone=…
 *
 * Le suivi est en GET : le client revient dessus par le lien qu'il a reçu,
 * et doit pouvoir le mettre en favori. Le téléphone en paramètre de requête
 * est un compromis assumé — il finit dans les journaux d'accès — mais un
 * suivi qui exige un POST n'est pas partageable, donc pas utilisé.
 */
exports.suivreCommande = asyncHandler(async (req, res) => {
  const data = await VitrineService.suivreCommande(req.params.reference, req.query.telephone);
  return ok(res, data, 'Commande retrouvée.');
});
