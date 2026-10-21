const { Op, literal } = require('sequelize');
const {
  Produit, Boutique, Utilisateur, Categorie, Promotion, ProduitImage, Avis,
} = require('../../models');
const { NotFoundError } = require('../../errors/AppError');
const CategorieService = require('../categories/categorie.service');

/**
 * Catalogue public : ce que voit un client, connecté ou non.
 *
 * Une seule forme de produit pour toute l'application cliente (accueil,
 * catégories, recherche, fiche, promotions) : prix payé, prix barré, remise,
 * fin de promotion pour le compte à rebours, boutique, options à choisir.
 *
 * Un produit est visible quand il est approuvé et que sa boutique ET son
 * vendeur sont actifs. Ce filtre est écrit en SQL (sous-requête) plutôt
 * qu'en `include` imbriqué : avec une pagination, Sequelize transforme les
 * include obligatoires en sous-requêtes fragiles.
 */

const VENDEUR_VISIBLE = literal(`"Produit"."vendeur_id" IN (
  SELECT b.vendeur_id FROM boutique b
    JOIN utilisateur u ON u.id = b.vendeur_id
   WHERE b.statut = 'actif' AND b.deleted_at IS NULL AND u.statut = 'actif'
)`);

const PROMO_ACTIVE = `EXISTS (
  SELECT 1 FROM promotion pr
   WHERE pr."produitId" = "Produit"."id" AND pr.active = TRUE
     AND pr."dateDebut" <= NOW() AND pr."dateFin" >= NOW()
     AND pr."prixPromo" < "Produit"."prix"
)`;

const EN_PROMO = literal(`(("Produit"."prix_promo" IS NOT NULL AND "Produit"."prix_promo" < "Produit"."prix") OR ${PROMO_ACTIVE})`);

const PRIX_EFFECTIF = `COALESCE(NULLIF(LEAST(
  COALESCE("Produit"."prix_promo", "Produit"."prix"),
  COALESCE((SELECT MIN(pr."prixPromo") FROM promotion pr
             WHERE pr."produitId" = "Produit"."id" AND pr.active = TRUE
               AND pr."dateDebut" <= NOW() AND pr."dateFin" >= NOW()), "Produit"."prix")
), 0), "Produit"."prix")`;

const TRIS = {
  recents: [['createdAt', 'DESC']],
  populaires: [['nombre_ventes', 'DESC'], ['vues', 'DESC'], ['createdAt', 'DESC']],
  prix_asc: [[literal(PRIX_EFFECTIF), 'ASC']],
  prix_desc: [[literal(PRIX_EFFECTIF), 'DESC']],
  promos: [[literal(PRIX_EFFECTIF + ' / NULLIF("Produit"."prix", 0)'), 'ASC']],
};

const ATTRIBUTS = [
  'id', 'nom', 'description', 'prix', 'prix_promo', 'quantite', 'image', 'marque',
  'attributs', 'disponible', 'vues', 'nombre_ventes', 'vendeurId', 'categorieId', 'createdAt',
];

const nombre = (v) => (v == null ? null : Number(v));

class CatalogueService {
  /** Boutiques actives des vendeurs donnés, par vendeur. */
  static async _boutiquesParVendeur(vendeurIds) {
    if (!vendeurIds.length) return new Map();
    const boutiques = await Boutique.findAll({
      where: { vendeurId: { [Op.in]: vendeurIds }, statut: 'actif' },
      attributes: ['id', 'nom', 'slug', 'logo', 'localisation', 'ville', 'telephone', 'whatsapp', 'vendeurId'],
      include: [{ model: Utilisateur, as: 'vendeur', attributes: ['id', 'statutValidation'] }],
    });
    return new Map(boutiques.map((b) => [b.vendeurId, b]));
  }

  /** Meilleure promotion en cours par produit (prix le plus bas). */
  static async _promotionsEnCours(produitIds) {
    if (!produitIds.length) return new Map();
    const now = new Date();
    const promos = await Promotion.findAll({
      where: {
        produitId: { [Op.in]: produitIds },
        active: true,
        dateDebut: { [Op.lte]: now },
        dateFin: { [Op.gte]: now },
      },
      attributes: ['produitId', 'prixPromo', 'dateFin', 'titre'],
      order: [['prixPromo', 'ASC']],
    });
    const parProduit = new Map();
    for (const p of promos) if (!parProduit.has(p.produitId)) parProduit.set(p.produitId, p);
    return parProduit;
  }

  /** Forme unique d'un produit côté client. */
  static _formater(produit, { boutique, promotion, specifications } = {}) {
    const p = produit.toJSON ? produit.toJSON() : produit;
    const prix = nombre(p.prix) || 0;

    // Prix payé : le plus bas entre le prix soldé du produit et la
    // promotion en cours — même règle que le serveur à la commande.
    let prixPromo = null;
    let finPromotion = null;
    const solde = nombre(p.prix_promo);
    if (solde != null && solde > 0 && solde < prix) prixPromo = solde;
    if (promotion) {
      const pp = nombre(promotion.prixPromo);
      if (pp > 0 && pp < prix && (prixPromo == null || pp <= prixPromo)) {
        prixPromo = pp;
        finPromotion = promotion.dateFin;
      }
    }

    // Options à choisir (tableaux) et informations (le reste), avec les
    // libellés de la catégorie quand ils existent.
    const libelles = Object.fromEntries((specifications || []).map((s) => [s.cle, s.libelle]));
    const options = [];
    const caracteristiques = [];
    for (const [cle, valeur] of Object.entries(p.attributs || {})) {
      const libelle = libelles[cle] || cle;
      if (Array.isArray(valeur)) {
        const valeurs = valeur.map(String).filter(Boolean);
        if (valeurs.length) options.push({ cle, libelle, valeurs });
      } else if (valeur !== null && valeur !== '' && valeur !== false) {
        caracteristiques.push({ cle, libelle, valeur: valeur === true ? 'Oui' : String(valeur) });
      }
    }

    const b = boutique ? (boutique.toJSON ? boutique.toJSON() : boutique) : null;
    return {
      id: p.id,
      nom: p.nom,
      description: p.description || '',
      prix,
      prixPromo,
      remise: prixPromo != null && prix > 0 ? Math.round((1 - prixPromo / prix) * 100) : 0,
      finPromotion,
      image: p.image || '',
      images: (p.images || []).sort((x, y) => (x.ordre || 0) - (y.ordre || 0)).map((i) => i.url).filter(Boolean),
      marque: p.marque || null,
      disponible: p.disponible !== false,
      stock: p.quantite ?? 0,
      enRupture: p.disponible !== false && (p.quantite ?? 0) <= 0,
      options,
      caracteristiques,
      categorie: p.categorie ? { id: p.categorie.id, nom: p.categorie.nom, slug: p.categorie.slug, icone: p.categorie.icone } : null,
      categorieId: p.categorieId,
      vendeurId: p.vendeurId,
      boutique: b ? {
        id: b.id,
        nom: b.nom,
        slug: b.slug,
        logo: b.logo,
        localisation: b.localisation || b.ville || '',
        telephone: b.whatsapp || b.telephone || '',
        verifiee: b.vendeur?.statutValidation === 'approuve',
      } : null,
      nombreVentes: p.nombre_ventes || 0,
      vues: p.vues || 0,
      nouveau: p.createdAt ? (Date.now() - new Date(p.createdAt).getTime()) < 14 * 864e5 : false,
    };
  }

  /** Complète une liste de produits (boutiques, promotions) puis la formate. */
  static async _enrichir(produits) {
    const [boutiques, promos] = await Promise.all([
      this._boutiquesParVendeur([...new Set(produits.map((p) => p.vendeurId))]),
      this._promotionsEnCours(produits.map((p) => p.id)),
    ]);
    return produits.map((p) => this._formater(p, {
      boutique: boutiques.get(p.vendeurId),
      promotion: promos.get(p.id),
      specifications: p.categorie?.specifications,
    }));
  }

  /**
   * Liste paginée.
   * @param {object} f categorie (id ou slug), boutique (id), q, tri, promo, page, limit, exclure
   */
  static async lister(f = {}) {
    const limit = Math.min(Math.max(parseInt(f.limit, 10) || 20, 1), 50);
    const page = Math.max(parseInt(f.page, 10) || 1, 1);
    const et = [VENDEUR_VISIBLE];
    const where = { statut: 'approuve' };

    let categorie = null;
    if (f.categorie) {
      categorie = await CategorieService.trouver(f.categorie);
      where.categorieId = categorie.id;
    }
    if (f.boutique) {
      const b = await Boutique.findByPk(f.boutique, { attributes: ['vendeurId'] });
      if (!b) throw new NotFoundError('Boutique introuvable');
      where.vendeurId = b.vendeurId;
    }
    if (f.promo === true || f.promo === 'true' || f.promo === '1') et.push(EN_PROMO);
    if (f.exclure) where.id = { [Op.ne]: f.exclure };

    const q = String(f.q || '').trim().slice(0, 80);
    if (q) {
      const motif = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      where[Op.or] = [
        { nom: { [Op.iLike]: motif } },
        { description: { [Op.iLike]: motif } },
        { marque: { [Op.iLike]: motif } },
        { '$categorie.nom$': { [Op.iLike]: motif } },
      ];
    }
    where[Op.and] = et;

    const { rows, count } = await Produit.findAndCountAll({
      where,
      attributes: ATTRIBUTS,
      include: [{ model: Categorie, as: 'categorie', attributes: ['id', 'nom', 'slug', 'icone', 'specifications'] }],
      order: TRIS[f.tri] || (f.promo ? TRIS.promos : TRIS.recents),
      limit,
      offset: (page - 1) * limit,
      distinct: true,
      subQuery: false,
    });

    return {
      categorie: categorie ? { id: categorie.id, nom: categorie.nom, slug: categorie.slug, icone: categorie.icone, description: categorie.description } : null,
      produits: await this._enrichir(rows),
      pagination: { page, limit, total: count, pages: Math.ceil(count / limit) },
    };
  }

  /** Fiche produit + produits similaires (même catégorie). */
  static async detail(id) {
    if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new NotFoundError('Produit introuvable');
    const produit = await Produit.findOne({
      where: { id, statut: 'approuve', [Op.and]: [VENDEUR_VISIBLE] },
      attributes: ATTRIBUTS,
      include: [
        { model: Categorie, as: 'categorie', attributes: ['id', 'nom', 'slug', 'icone', 'specifications'] },
        { model: ProduitImage, as: 'images', attributes: ['url', 'ordre'] },
      ],
    });
    if (!produit) throw new NotFoundError("Ce produit n'existe pas ou n'est plus en vente.");

    // Compteur de vues, sans bloquer la réponse.
    Produit.increment('vues', { where: { id: produit.id } }).catch(() => {});

    const [fiche] = await this._enrichir([produit]);

    // Similaires : même catégorie, la même boutique d'abord.
    const similaires = produit.categorieId
      ? (await this.lister({ categorie: produit.categorieId, exclure: produit.id, tri: 'populaires', limit: 12 })).produits
      : [];
    similaires.sort((a, b) => (b.vendeurId === produit.vendeurId) - (a.vendeurId === produit.vendeurId));

    return { produit: fiche, similaires: similaires.slice(0, 10) };
  }

  /** Promotions en cours, celles qui finissent le plus tôt d'abord. */
  static async promotions({ limit = 20, page = 1 } = {}) {
    const res = await this.lister({ promo: true, limit, page, tri: 'promos' });
    res.produits.sort((a, b) => {
      if (a.finPromotion && b.finPromotion) return new Date(a.finPromotion) - new Date(b.finPromotion);
      if (a.finPromotion) return -1;
      if (b.finPromotion) return 1;
      return b.remise - a.remise;
    });
    return res;
  }

  /** Fiche publique d'une boutique (sans ses produits, chargés à part). */
  static async boutique(id) {
    const b = await Boutique.findOne({
      where: { id, statut: 'actif' },
      attributes: [
        'id', 'nom', 'slug', 'description', 'slogan', 'logo', 'banniere', 'localisation', 'ville', 'telephone', 'whatsapp',
        'categorie', 'vendeurId', 'createdAt', 'couleur_theme', 'vitrineAccent', 'vitrineApropos', 'vitrineHoraires',
        'vitrineReseaux', 'vitrineSectionsPerso', 'vitrineBlocs', 'vitrineSections',
      ],
      include: [{
        model: Utilisateur, as: 'vendeur', attributes: ['id', 'prenom', 'nom', 'statutValidation'],
        where: { statut: 'actif' }, required: true,
      }],
    });
    if (!b) throw new NotFoundError("Cette boutique n'existe pas ou n'est plus en ligne.");
    const brut = b.toJSON();
    const [nombreProduits, avis] = await Promise.all([
      Produit.count({ where: { vendeurId: b.vendeurId, statut: 'approuve' } }),
      Avis.findAll({ where: { boutiqueId: b.id }, attributes: ['note'], raw: true }),
    ]);
    const notes = avis.map((a) => Number(a.note)).filter((n) => !Number.isNaN(n));

    // La page de la boutique dans l'application est la même que son site :
    // les sections choisies par le vendeur, dans son ordre, avec leurs
    // produits. Une section sans produit visible n'est pas renvoyée.
    const sectionsPerso = Array.isArray(brut.vitrineSectionsPerso) ? brut.vitrineSectionsPerso : [];
    const ids = [...new Set(sectionsPerso.flatMap((s) => s.produitIds || []))].filter((x) => /^[0-9a-f-]{36}$/i.test(String(x)));
    const produits = ids.length
      ? await Produit.findAll({
        where: { id: ids, vendeurId: b.vendeurId, statut: 'approuve', [Op.and]: [VENDEUR_VISIBLE] },
        attributes: ATTRIBUTS,
        include: [{ model: Categorie, as: 'categorie', attributes: ['id', 'nom', 'slug', 'icone', 'specifications'] }],
      })
      : [];
    const parId = new Map((await this._enrichir(produits)).map((p) => [p.id, p]));
    const sections = sectionsPerso
      .map((s) => ({ id: s.id, titre: s.titre, produits: (s.produitIds || []).map((pid) => parId.get(pid)).filter(Boolean) }))
      .filter((s) => s.produits.length);

    const blocs = brut.vitrineBlocs && typeof brut.vitrineBlocs === 'object' ? brut.vitrineBlocs : {};
    const {
      vitrineSectionsPerso, vitrineBlocs, vitrineSections, vitrineAccent, vitrineApropos, vitrineHoraires,
      vitrineReseaux, couleur_theme: couleurTheme, ...publique
    } = brut;

    return {
      boutique: {
        ...publique,
        localisation: brut.localisation || brut.ville || '',
        verifiee: brut.vendeur?.statutValidation === 'approuve',
        nombreProduits,
        depuis: brut.createdAt ? new Date(brut.createdAt).getFullYear() : null,
        note: notes.length ? Math.round((notes.reduce((t, n) => t + n, 0) / notes.length) * 10) / 10 : null,
        nombreAvis: notes.length,
        accent: vitrineAccent || couleurTheme || '#0D1B3D',
        apropos: vitrineSections?.apropos === false ? null : (vitrineApropos || null),
        horaires: vitrineHoraires || null,
        reseaux: vitrineReseaux || {},
        avantages: Array.isArray(blocs.avantages) ? blocs.avantages : [],
        sections,
      },
    };
  }
}

module.exports = CatalogueService;
