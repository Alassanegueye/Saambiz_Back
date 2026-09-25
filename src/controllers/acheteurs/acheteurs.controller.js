const AcheteurService = require('../../services/acheteurs/acheteurs.service');
const AccueilService = require('../../services/acheteurs/accueil.service');
const asyncHandler = require('../../middlewares/asyncHandler');
const { BadRequestError, NotFoundError } = require('../../errors/AppError');

/**
 * Catalogue vu par l'acheteur.
 *
 * Chaque méthode était enveloppée dans un try/catch qui journalisait
 * `logger.error('', { err })` alors que la variable capturée s'appelait
 * `error` : la référence manquante levait une ReferenceError *dans* le catch,
 * la requête restait ouverte et rien n'était tracé. Le gestionnaire global
 * supprime le problème à la racine.
 */
class AcheteurController {
  // 1. LISTE PRODUITS
  static listerProduits = asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const result = await AcheteurService.listerTousProduits(req.user.id, page);

    if (!result?.produits?.length) {
      throw new NotFoundError(
        'Aucun produit des boutiques que vous suivez. Abonnez-vous à des boutiques pour voir leurs produits.'
      );
    }

    return res.status(200).json({ success: true, ...result });
  });

  // 2. RECHERCHE
  static rechercherProduits = asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const { q } = req.query;

    if (!q || !q.trim()) {
      throw new BadRequestError('Le paramètre "q" est requis pour la recherche');
    }

    const result = await AcheteurService.rechercherProduits(req.user.id, q.trim(), page);

    if (!result?.produits?.length) {
      throw new NotFoundError(`Aucun produit trouvé correspondant à "${q.trim()}".`);
    }

    return res.status(200).json({ success: true, ...result });
  });

  // 3. FILTRE PAR VILLE
  static filtrerParVille = asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const { ville } = req.query;

    if (!ville || !ville.trim()) {
      throw new BadRequestError('Le paramètre "ville" est requis');
    }

    const result = await AcheteurService.filtrerParVille(req.user.id, ville.trim(), page);

    if (!result?.produits?.length) {
      throw new NotFoundError(`Aucun produit trouvé dans la ville "${ville.trim()}".`);
    }

    return res.status(200).json({ success: true, ...result });
  });

  // 4. LISTE BOUTIQUES
  static listerBoutiques = asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const result = await AcheteurService.listerBoutiques(page);

    if (!result?.boutiques?.length) {
      throw new NotFoundError('Aucune boutique disponible pour le moment.');
    }

    return res.status(200).json({ success: true, ...result });
  });

  // 5. GÉNÉRATION LIEN WHATSAPP
  static contacterVendeurWhatsapp = asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!id || !String(id).trim()) {
      throw new BadRequestError('ID du produit invalide');
    }

    // Le service échoue si le produit n'existe pas ou si le vendeur n'a pas
    // renseigné de téléphone — dans les deux cas il n'y a rien à joindre.
    const whatsappUrl = await AcheteurService.contacterVendeurWhatsapp(id).catch((err) => {
      if (err.message.includes('non trouvé') || err.message.includes('Téléphone')) {
        throw new NotFoundError(err.message);
      }
      throw err;
    });

    return res.status(200).json({
      success: true,
      message: 'Lien WhatsApp généré avec succès',
      whatsappUrl
    });
  });

  // 7. INCRÉMENTER VUES
  static incrementerVues = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await AcheteurService.incrementerVues(id);
    // Consulter un produit renforce l'affinité pour sa catégorie : c'est le
    // signal le plus fréquent, d'où son poids faible côté service.
    if (req.user?.id) {
      const categorie = result?.produit?.categorie?.nom
        || result?.produit?.categorie
        || null;
      AccueilService.enregistrerAffinite(req.user.id, categorie, 'vue').catch(() => {});
    }
    return res.status(200).json({ success: true, ...result });
  });

  // 8. DÉTAIL PRODUIT
  static getDetailProduit = asyncHandler(async (req, res) => {
    const result = await AcheteurService.getDetailProduit(req.params.id).catch((err) => {
      if (err.message === 'Produit introuvable') throw new NotFoundError(err.message);
      throw err;
    });
    return res.status(200).json({ success: true, ...result });
  });

  // 9. DÉTAIL BOUTIQUE
  static getDetailBoutique = asyncHandler(async (req, res) => {
    const result = await AcheteurService.getDetailBoutique(req.params.id).catch((err) => {
      if (err.message === 'Boutique introuvable') throw new NotFoundError(err.message);
      throw err;
    });
    return res.status(200).json({ success: true, ...result });
  });

  // 10. BOUTIQUES PROCHES
  static boutiquesProches = asyncHandler(async (req, res) => {
    const { lat, lng, rayon } = req.query;
    if (!lat || !lng) {
      throw new BadRequestError('Les paramètres lat et lng sont requis');
    }
    const result = await AcheteurService.boutiquesProches(lat, lng, rayon || 5);
    return res.status(200).json({ success: true, ...result });
  });

  // 11. LISTE PRODUITS AVEC FILTRES AVANCÉS
  static listerProduitsAvecFiltres = asyncHandler(async (req, res) => {
    const result = await AcheteurService.listerProduitsAvecFiltres({
      ...req.query,
      acheteurId: req.user.id,
    });
    return res.status(200).json({ success: true, ...result });
  });

  // DÉCOUVERTE (feed populaire, toutes boutiques — pour trouver qui suivre)
  static decouverte = asyncHandler(async (req, res) => {
    const result = await AcheteurService.decouverte({ page: parseInt(req.query.page) || 1 });
    return res.status(200).json({ success: true, ...result });
  });

  // 12. PRODUITS TENDANCE
  static produitsTendance = asyncHandler(async (req, res) => {
    const result = await AcheteurService.produitsTendance(req.user.id, req.query.limite);
    return res.status(200).json({ success: true, ...result });
  });

  // 13. NOUVELLES BOUTIQUES
  static nouvellesBoutiques = asyncHandler(async (req, res) => {
    const result = await AcheteurService.nouvellesBoutiques(req.query.limite);
    return res.status(200).json({ success: true, ...result });
  });

  // 14. BOUTIQUES VÉRIFIÉES
  static boutiquesVerifiees = asyncHandler(async (req, res) => {
    const result = await AcheteurService.boutiquesVerifiees(req.query.page);
    return res.status(200).json({ success: true, ...result });
  });

  // 15. PROMOTIONS ACTIVES (vue acheteur)
  static promotionsActives = asyncHandler(async (req, res) => {
    const result = await AcheteurService.promotionsActives(req.user.id, req.query.page);
    return res.status(200).json({ success: true, ...result });
  });

  // 16. RECHERCHE GLOBALE
  static rechercheGlobale = asyncHandler(async (req, res) => {
    const { q, page } = req.query;
    if (!q || !q.trim()) {
      throw new BadRequestError('Le paramètre "q" est requis');
    }
    const result = await AcheteurService.rechercheGlobale(req.user.id, q, page);
    // Ce que le client cherche aujourd'hui oriente son accueil de demain.
    AccueilService.enregistrerRecherche(req.user.id, q).catch(() => {});
    return res.status(200).json({ success: true, ...result });
  });

  // 17. PAGE ACCUEIL
  static accueil = asyncHandler(async (req, res) => {
    const result = await AcheteurService.accueil(req.user.id);
    return res.status(200).json({ success: true, ...result });
  });

  // 18. MES CONVERSATIONS (vue acheteur)
  static mesConversations = asyncHandler(async (req, res) => {
    const result = await AcheteurService.mesConversations(req.user.id);
    return res.status(200).json({ success: true, ...result });
  });

  // 21. TABLEAU DE BORD ACHETEUR
  static monTableauDeBord = asyncHandler(async (req, res) => {
    const result = await AcheteurService.monTableauDeBord(req.user.id);
    return res.status(200).json({ success: true, ...result });
  });

  // 6. PRODUITS PAR BOUTIQUE
  static getProduitsByBoutique = asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const { boutiqueId } = req.params;

    if (!boutiqueId || !String(boutiqueId).trim()) {
      throw new BadRequestError('ID de boutique invalide');
    }

    const result = await AcheteurService.getProduitsByBoutique(boutiqueId, page).catch((err) => {
      if (err.message === 'Boutique introuvable') throw new NotFoundError(err.message);
      throw err;
    });

    if (!result?.produits?.length) {
      throw new NotFoundError(
        `Aucun produit trouvé pour la boutique "${result.boutique?.nom || 'cette boutique'}"`
      );
    }

    return res.status(200).json({ success: true, ...result });
  });
}

module.exports = AcheteurController;
