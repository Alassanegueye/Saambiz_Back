const VendeurService = require('../../services/vendeurs/vendeur.service');
const asyncHandler = require('../../middlewares/asyncHandler');
const AssistantService = require('../../services/vitrine/assistant.service');
// Format unique des réponses — les nouvelles routes l'utilisent.
const { ok } = require('../../utils/response');
const { BadRequestError } = require('../../errors/AppError');

/**
 * Espace vendeur.
 *
 * Le service lève désormais des erreurs typées (404 introuvable, 409 doublon,
 * 400 règle métier) : le contrôleur n'a plus à deviner un statut en lisant le
 * texte du message, et une panne inattendue ne sort plus en 404.
 *
 * H-05 : aucun `err.message` technique ne fuit dans un 500 — le gestionnaire
 * global masque les messages des erreurs non opérationnelles en production.
 */
class VendeurController {

  // -------------------- VÉRIFICATION DU PROFIL --------------------
  static soumettreVerification = asyncHandler(async (req, res) => {
    const fichier = req.files?.piece?.[0] || req.file;
    const result = await VendeurService.soumettreVerification(req.user.id, {
      fichier,
      typePiece: req.body?.typePiece,
    });
    // Le corps d'échec porte plus que le message (statut courant, motif de
    // rejet précédent) : on le renvoie tel quel plutôt que de le réduire.
    if (!result.success) return res.status(400).json(result);
    return res.status(200).json(result);
  });

  static statutVerification = asyncHandler(async (req, res) => {
    const result = await VendeurService.statutVerification(req.user.id);
    if (!result.success) return res.status(404).json(result);
    return res.status(200).json(result);
  });

  // -------------------- LISTER PRODUITS --------------------
  static listerProduits = asyncHandler(async (req, res) => {
    const { page, limit } = req.query;
    const result = await VendeurService.listerProduits(req.user.id, { page, limit });
    return res.status(200).json({ success: true, ...result });
  });

  // -------------------- AJOUTER PRODUIT --------------------
  static ajouterProduit = asyncHandler(async (req, res) => {
    const vendeurId = req.user.id;
    const { nom, description, prix, prix_promo, quantite, categorieId, marque, attributs, disponible } = req.body;
    const image = req.file;
    const nomVendeur = `${req.user.prenom || ''} ${req.user.nom || ''}`.trim();

    const produit = await VendeurService.ajouterProduit(vendeurId, {
      nom,
      description,
      prix,
      prix_promo,
      quantite,
      categorieId,
      image,
      marque,
      attributs,
      disponible,
      nomVendeur
    });

    return res.status(201).json({ success: true, produit });
  });

  // -------------------- MODIFIER PRODUIT --------------------
  static modifierProduit = asyncHandler(async (req, res) => {
    const updates = { ...req.body };
    const image = req.file;
    if (image) updates.image = image;

    const produit = await VendeurService.modifierProduit(req.user.id, req.params.id, updates);
    return res.status(200).json({ success: true, produit });
  });

  // -------------------- SUPPRIMER PRODUIT --------------------
  static supprimerProduit = asyncHandler(async (req, res) => {
    const result = await VendeurService.supprimerProduit(req.user.id, req.params.id);
    return res.status(200).json(result);
  });

  // -------------------- NOMBRE TOTAL DE PRODUITS --------------------
  static nombreProduits = asyncHandler(async (req, res) => {
    const stats = await VendeurService.getNombreProduits(req.user.id);
    return res.status(200).json({ success: true, stats });
  });

  // -------------------- NOMBRE DE PRODUITS PAR CATEGORIE --------------------
  static produitsParCategorie = asyncHandler(async (req, res) => {
    const stats = await VendeurService.getProduitsParCategorie(req.user.id);
    return res.status(200).json({ success: true, stats });
  });

  // -------------------- MA BOUTIQUE --------------------
  static maBoutique = asyncHandler(async (req, res) => {
    const result = await VendeurService.maBoutique(req.user.id);
    return res.status(200).json({ success: true, ...result });
  });

  // -------------------- CRÉER BOUTIQUE --------------------
  static creerBoutique = asyncHandler(async (req, res) => {
    // upload.fields → req.files = { logo: [file], banniere: [file] }
    const files = {
      logo: req.files?.logo?.[0],
      banniere: req.files?.banniere?.[0],
    };
    const result = await VendeurService.creerBoutique(req.user.id, req.body, files);
    return res.status(201).json({ success: true, ...result });
  });

  // -------------------- MODIFIER BOUTIQUE --------------------
  static modifierBoutique = asyncHandler(async (req, res) => {
    const files = {
      logo: req.files?.logo?.[0],
      banniere: req.files?.banniere?.[0],
    };
    const result = await VendeurService.modifierBoutique(req.user.id, req.body, files);
    return res.status(200).json({ success: true, ...result });
  });

  // -------------------- ASSISTANT DE CRÉATION DU SITE --------------------
  // Le vendeur téléverse son logo, dit ce qu'il vend, et le site est composé.
  // Ce parcours est celui de l'application mobile ; le tableau de bord web
  // n'expose que la reprise des réglages, une fois le site créé.

  /** Les secteurs proposés à la première question de l'assistant. */
  static secteursVitrine = asyncHandler(async (req, res) => {
    return ok(res, { secteurs: AssistantService.getSecteurs() }, 'Secteurs disponibles.');
  });

  /**
   * Analyse un logo sans rien enregistrer : couleurs, forme, palette proposée.
   * Séparé de la création pour que le vendeur voie ce qui a été trouvé et
   * puisse changer de fichier avant de valider.
   */
  static analyserLogoVitrine = asyncHandler(async (req, res) => {
    const fichier = req.files?.logo?.[0] || req.file;
    const analyse = await AssistantService.analyserLogo(fichier);

    // La proposition complète accompagne l'analyse : l'application affiche
    // ainsi la mise en page et les textes retenus dès cet écran, sans un
    // second aller-retour sur une connexion mobile.
    const { Boutique } = require('../../models');
    const boutique = await Boutique.findOne({ where: { vendeurId: req.user.id } });

    const proposition = AssistantService.composerProposition({
      nomBoutique: boutique?.nom,
      ville: boutique?.ville || boutique?.localisation,
      secteur: req.body?.secteur,
      activite: req.body?.activite,
      analyse,
    });

    return ok(res, { analyse, proposition }, 'Logo analysé.');
  });

  /** Crée le site et le publie — dernière étape de l'assistant. */
  static genererVitrine = asyncHandler(async (req, res) => {
    const fichier = req.files?.logo?.[0] || req.file;

    // Le corps arrive en multipart quand un logo l'accompagne : les objets
    // imbriqués (sections) y transitent alors en JSON encodé.
    const reponses = { ...req.body };
    if (typeof reponses.sections === 'string') {
      try { reponses.sections = JSON.parse(reponses.sections); } catch { reponses.sections = undefined; }
    }
    for (const drapeau of ['active', 'commande', 'paiementLivraison']) {
      if (typeof reponses[drapeau] === 'string') {
        reponses[drapeau] = reponses[drapeau] !== 'false';
      }
    }

    const resultat = await AssistantService.genererVitrine(req.user.id, reponses, fichier);

    // Le site existe même si l'hébergeur d'images a refusé le logo : on le dit
    // plutôt que de laisser le vendeur découvrir tout seul qu'il manque.
    const message = resultat.logoEnregistre === false
      ? "Votre site vitrine est prêt. Votre logo n'a pas pu être enregistré — reprenez-le depuis « Ma boutique »."
      : 'Votre site vitrine est prêt.';

    return ok(res, resultat, message);
  });

  // -------------------- VITRINE (SITE WEB DE LA BOUTIQUE) --------------------
  // Réglages du site public du vendeur : adresse, mise en page, couleur,
  // sections affichées, ouverture de la caisse. Le site lui-même est servi
  // par les routes /vitrine, sans authentification.
  static maVitrine = asyncHandler(async (req, res) => {
    const result = await VendeurService.maVitrine(req.user.id);
    return ok(res, result, 'Réglages de votre site.');
  });

  static majVitrine = asyncHandler(async (req, res) => {
    const result = await VendeurService.majVitrine(req.user.id, req.body);
    return ok(res, result, 'Votre site a été mis à jour.');
  });

  // -------------------- MON ABONNEMENT --------------------
  static monAbonnement = asyncHandler(async (req, res) => {
    const result = await VendeurService.monAbonnement(req.user.id);
    return res.status(200).json({ success: true, ...result });
  });

  // -------------------- INITIER RENOUVELLEMENT --------------------
  static initierRenouvellement = asyncHandler(async (req, res) => {
    const result = await VendeurService.initierRenouvellement(req.user.id);
    return res.status(200).json({ success: true, ...result });
  });

  // -------------------- STATISTIQUES VUES --------------------
  static statistiquesVues = asyncHandler(async (req, res) => {
    const result = await VendeurService.statistiquesVues(req.user.id);
    return res.status(200).json({ success: true, ...result });
  });

  // -------------------- DASHBOARD --------------------
  static dashboard = asyncHandler(async (req, res) => {
    const result = await VendeurService.dashboard(req.user.id);
    return res.status(200).json({ success: true, ...result });
  });

  // -------------------- STATISTIQUES AVANCÉES --------------------
  static statistiquesAvancees = asyncHandler(async (req, res) => {
    const result = await VendeurService.statistiquesAvancees(req.user.id);
    return res.status(200).json({ success: true, ...result });
  });

  // -------------------- TOGGLE DISPONIBILITÉ --------------------
  static toggleDisponibilite = asyncHandler(async (req, res) => {
    const result = await VendeurService.toggleDisponibilite(req.user.id, req.params.id);
    return res.status(200).json({ success: true, ...result });
  });

  // -------------------- MODE PAUSE --------------------
  static pauseBoutique = asyncHandler(async (req, res) => {
    const result = await VendeurService.pauseBoutique(req.user.id);
    return res.status(200).json({ success: true, ...result });
  });

  static reactiverBoutique = asyncHandler(async (req, res) => {
    const result = await VendeurService.reactiverBoutique(req.user.id);
    return res.status(200).json({ success: true, ...result });
  });

  // -------------------- DUPLIQUER PRODUIT --------------------
  static dupliquerProduit = asyncHandler(async (req, res) => {
    const result = await VendeurService.dupliquerProduit(req.user.id, req.params.id);
    return res.status(201).json({ success: true, ...result });
  });

  // -------------------- RECHERCHE PRODUITS --------------------
  static rechercherMesProduits = asyncHandler(async (req, res) => {
    const result = await VendeurService.rechercherMesProduits(req.user.id, req.query);
    return res.status(200).json({ success: true, ...result });
  });

  // -------------------- HISTORIQUE PAIEMENTS --------------------
  static historiquePaiements = asyncHandler(async (req, res) => {
    const { page, limit } = req.query;
    const result = await VendeurService.historiquePaiements(req.user.id, { page, limit });
    return res.status(200).json({ success: true, ...result });
  });

  // -------------------- MES CONVERSATIONS --------------------
  static mesConversations = asyncHandler(async (req, res) => {
    const { page, limit } = req.query;
    const result = await VendeurService.mesConversations(req.user.id, { page, limit });
    return res.status(200).json({ success: true, ...result });
  });

  // -------------------- IMAGES MULTIPLES PRODUIT --------------------
  static ajouterImagesProduit = asyncHandler(async (req, res) => {
    const files = req.files || [];
    if (!files.length) {
      throw new BadRequestError('Aucune image fournie (champ "images")');
    }
    const images = await VendeurService.ajouterImagesProduit(req.user.id, req.params.id, files);
    return res.status(201).json({ success: true, images });
  });

  static supprimerImageProduit = asyncHandler(async (req, res) => {
    const { id: produitId, imageId } = req.params;
    const result = await VendeurService.supprimerImageProduit(req.user.id, produitId, imageId);
    return res.status(200).json({ success: true, ...result });
  });

}

module.exports = VendeurController;
