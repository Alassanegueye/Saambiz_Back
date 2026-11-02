const CatalogueService = require('../../services/catalogue/catalogue.service');
const AccueilService = require('../../services/acheteurs/accueil.service');
const asyncHandler = require('../../middlewares/asyncHandler');

/**
 * Ce que le client connecté regarde et cherche dans le catalogue nourrit ses
 * goûts, donc son accueil. Toujours après la réponse et sans await : la
 * personnalisation ne doit jamais ralentir ni faire échouer la navigation.
 */
const apprendre = (req, geste) => {
  if (!req.user?.id) return;
  Promise.resolve().then(geste).catch(() => {});
};

/** Catalogue public : ouvert aux invités, enrichi si le client est connecté. */
exports.lister = asyncHandler(async (req, res) => {
  const { categorie, boutique, q, tri, promo, page, limit } = req.query;
  const resultat = await CatalogueService.lister({ categorie, boutique, q, tri, promo, page, limit });
  res.json({ success: true, ...resultat });

  // Seule la première page compte : faire défiler n'est pas un nouveau geste.
  if (Number(page || 1) !== 1) return;
  const terme = String(q || '').trim();
  apprendre(req, async () => {
    if (terme) {
      // Une recherche oriente vers les catégories des premiers résultats.
      await AccueilService.enregistrerRecherche(req.user.id, terme);
      await AccueilService.enregistrerAffinites(
        req.user.id,
        resultat.produits.slice(0, 5).map((p) => p.categorie?.nom),
        'recherche',
      );
    } else if (resultat.categorie) {
      await AccueilService.enregistrerAffinite(req.user.id, resultat.categorie.nom, 'vue');
    }
  });
});

exports.detail = asyncHandler(async (req, res) => {
  const resultat = await CatalogueService.detail(req.params.id);
  res.json({ success: true, ...resultat });
  apprendre(req, () => AccueilService.enregistrerAffinite(
    req.user.id, resultat.produit?.categorie?.nom, 'vue',
  ));
});

exports.promotions = asyncHandler(async (req, res) => {
  const { page, limit } = req.query;
  res.json({ success: true, ...(await CatalogueService.promotions({ page, limit })) });
});

exports.rechercherBoutiques = asyncHandler(async (req, res) => {
  const { q, limit } = req.query;
  const resultat = await CatalogueService.rechercherBoutiques({ q, limit });
  res.json({ success: true, ...resultat });
  // Le terme lui-même est mémorisé par la recherche de produits lancée en
  // même temps ; ici, seules les catégories des boutiques trouvées comptent.
  apprendre(req, () => AccueilService.enregistrerAffinites(
    req.user.id, resultat.boutiques.slice(0, 5).map((b) => b.categorie), 'recherche',
  ));
});

exports.boutique = asyncHandler(async (req, res) => {
  const resultat = await CatalogueService.boutique(req.params.id);
  res.json({ success: true, ...resultat });
  apprendre(req, () => AccueilService.enregistrerAffinite(
    req.user.id, resultat.boutique?.categorie, 'vue',
  ));
});
