const AdminService = require('../../services/admin/admin.service');
const ConfigService = require('../../services/config/config.service');
const formatUser = require('../../utils/formatUser');
const DemandeRetourService = require('../../services/commandes/demandeRetour.service');
const AuditService = require('../../services/audit.service');
const asyncHandler = require('../../middlewares/asyncHandler');
const { BadRequestError } = require('../../errors/AppError');

/**
 * Administration de la plateforme.
 *
 * Le service lève des erreurs typées (404 introuvable, 403 compte protégé,
 * 409 ressource encore référencée) : le contrôleur ne compare plus de chaînes
 * de caractères pour deviner un code HTTP.
 *
 * Chaque action sensible est tracée dans le journal d'audit. L'écriture est
 * volontairement détachée (`.catch(() => {})`) : une panne du journal ne doit
 * pas annuler une action déjà effectuée.
 */

/** Trace une action d'administration sans jamais faire échouer la requête. */
const tracer = (req, action, cible, cibleId, details = {}) =>
  AuditService.enregistrer({ adminId: req.user.id, action, cible, cibleId, details })
    .catch(() => {});

// -------------------- LISTE DES VENDEURS --------------------
exports.listeVendeur = asyncHandler(async (req, res) => {
  const result = await AdminService.listerVendeur();
  return res.status(200).json({
    message: result.message,
    vendeurs: result.vendeurs.map((vendeur) => formatUser(vendeur)),
  });
});

// -------------------- NOMBRE DE VENDEURS ACTIF --------------------
exports.nombreVendeursActif = asyncHandler(async (req, res) => {
  const result = await AdminService.nombreVendeursActif();
  return res.status(200).json(result);
});

// -------------------- NOMBRE DE VENDEURS inactif--------------------
exports.nombreVendeursInactif = asyncHandler(async (req, res) => {
  const result = await AdminService.nombreVendeursInactif();
  return res.status(200).json(result);
});

// -------------------- LISTE DES PRODUITS ACTIFS --------------------
exports.listeProduitsActifs = asyncHandler(async (req, res) => {
  const result = await AdminService.listerProduitsActifs();
  return res.status(200).json({ message: result.message, produits: result.produits });
});

// -------------------- NOMBRE DE PRODUITS ACTIFS --------------------
exports.nombreProduitsActifs = asyncHandler(async (req, res) => {
  const result = await AdminService.nombreProduitsActifs();
  return res.status(200).json(result);
});

// -------------------- LISTE DES CLIENTS --------------------
exports.listeClients = asyncHandler(async (req, res) => {
  const result = await AdminService.listerClients();
  return res.status(200).json({ message: result.message, clients: result.clients });
});

// -------------------- NOMBRE DE CLIENTS --------------------
exports.nombreClientsActifs = asyncHandler(async (req, res) => {
  const result = await AdminService.nombreClientsActifs();
  return res.status(200).json(result);
});

// -------------------- NOMBRE DE CLIENTS --------------------
exports.nombreClientsInactifs = asyncHandler(async (req, res) => {
  const result = await AdminService.nombreClientsInactifs();
  return res.status(200).json(result);
});

exports.ajoutCategorie = asyncHandler(async (req, res) => {
  const result = await AdminService.creerCategorie(req.body);
  res.status(201).json(result);
});

// -------------------- SUSPENDRE VENDEUR --------------------
exports.suspendreVendeur = asyncHandler(async (req, res) => {
  const result = await AdminService.suspendreVendeur(req.params.id);
  tracer(req, 'suspendre_vendeur', 'vendeur', req.params.id);
  return res.status(200).json(result);
});

// -------------------- ACTIVER VENDEUR --------------------
exports.activerVendeur = asyncHandler(async (req, res) => {
  const result = await AdminService.activerVendeur(req.params.id);
  tracer(req, 'activer_vendeur', 'vendeur', req.params.id);
  return res.status(200).json(result);
});

// -------------------- SUSPENDRE ACHETEUR --------------------
exports.suspendreAcheteur = asyncHandler(async (req, res) => {
  const result = await AdminService.suspendreAcheteur(req.params.id);
  tracer(req, 'suspendre_acheteur', 'acheteur', req.params.id);
  return res.status(200).json(result);
});

// -------------------- LISTE ABONNEMENTS --------------------
exports.getAbonnements = asyncHandler(async (req, res) => {
  const result = await AdminService.getAbonnements();
  return res.status(200).json(result);
});

// -------------------- STATS GLOBALES --------------------
exports.getStatsGlobales = asyncHandler(async (req, res) => {
  const result = await AdminService.getStatsGlobales();
  return res.status(200).json(result);
});

// -------------------- APPROUVER PRODUIT --------------------
exports.approuverProduit = asyncHandler(async (req, res) => {
  const result = await AdminService.approuverProduit(req.params.id);
  tracer(req, 'approuver_produit', 'produit', req.params.id);
  return res.status(200).json(result);
});

// -------------------- REJETER PRODUIT --------------------
exports.rejeterProduit = asyncHandler(async (req, res) => {
  const result = await AdminService.rejeterProduit(req.params.id);
  tracer(req, 'rejeter_produit', 'produit', req.params.id);
  return res.status(200).json(result);
});

// -------------------- SUPPRIMER PRODUIT --------------------
exports.supprimerProduit = asyncHandler(async (req, res) => {
  const result = await AdminService.supprimerProduit(req.params.id);
  tracer(req, 'supprimer_produit', 'produit', req.params.id);
  return res.status(200).json(result);
});

// -------------------- SUPPRIMER BOUTIQUE --------------------
exports.supprimerBoutique = asyncHandler(async (req, res) => {
  const result = await AdminService.supprimerBoutique(req.params.id);
  tracer(req, 'supprimer_boutique', 'boutique', req.params.id);
  return res.status(200).json(result);
});

// -------------------- SUPPRIMER UTILISATEUR --------------------
exports.supprimerUtilisateur = asyncHandler(async (req, res) => {
  const result = await AdminService.supprimerUtilisateur(req.params.id);
  tracer(req, 'supprimer_utilisateur', 'utilisateur', req.params.id);
  return res.status(200).json(result);
});

// -------------------- METTRE À JOUR LE PRIX D'ABONNEMENT --------------------
exports.updatePrixAbonnement = asyncHandler(async (req, res) => {
  const num = parseInt(req.body.prix, 10);
  if (Number.isNaN(num) || num <= 0) {
    throw new BadRequestError('Le prix doit être un entier positif');
  }

  const result = await ConfigService.modifierConfig({
    cle: 'prix_abonnement',
    valeur: String(num),
    adminId: req.user.id,
  });
  tracer(req, 'modifier_prix_abonnement', 'config', 'prix_abonnement', { prix: num });
  return res.status(200).json({ ...result, prix: num });
});

// ── Validation des profils vendeurs (pièce justificative) ──
exports.vendeursAValider = asyncHandler(async (req, res) => {
  const result = await AdminService.vendeursAValider();
  return res.status(200).json(result);
});

exports.validerProfilVendeur = asyncHandler(async (req, res) => {
  const result = await AdminService.validerProfilVendeur(req.params.id, req.user.id);
  tracer(req, 'valider_profil_vendeur', 'vendeur', req.params.id);
  return res.status(200).json(result);
});

exports.rejeterProfilVendeur = asyncHandler(async (req, res) => {
  const motif = req.body?.motif;
  const result = await AdminService.rejeterProfilVendeur(req.params.id, req.user.id, motif);
  tracer(req, 'rejeter_profil_vendeur', 'vendeur', req.params.id, { motif });
  return res.status(200).json(result);
});

// -------------------- VÉRIFIER VENDEUR --------------------
exports.verifierVendeur = asyncHandler(async (req, res) => {
  const result = await AdminService.verifierVendeur(req.params.id);
  tracer(req, 'verifier_vendeur', 'vendeur', req.params.id);
  return res.status(200).json(result);
});

// -------------------- SIGNALEMENTS --------------------
exports.getSignalements = asyncHandler(async (req, res) => {
  const result = await AdminService.getSignalements();
  return res.status(200).json(result);
});

exports.traiterSignalement = asyncHandler(async (req, res) => {
  const result = await AdminService.traiterSignalement(req.params.id);
  tracer(req, 'traiter_signalement', 'signalement', req.params.id);
  return res.status(200).json(result);
});

exports.rejeterSignalement = asyncHandler(async (req, res) => {
  const result = await AdminService.rejeterSignalement(req.params.id);
  tracer(req, 'rejeter_signalement', 'signalement', req.params.id);
  return res.status(200).json(result);
});

// -------------------- KPIs --------------------

exports.revenusParMois = asyncHandler(async (req, res) => {
  const result = await AdminService.revenusParMois(req.query.annee);
  return res.status(200).json(result);
});

exports.inscriptionsMensuelles = asyncHandler(async (req, res) => {
  const result = await AdminService.inscriptionsMensuelles(req.query.annee);
  return res.status(200).json(result);
});

exports.abonnementsExpirationProche = asyncHandler(async (req, res) => {
  const result = await AdminService.abonnementsExpirationProche(req.query.jours);
  return res.status(200).json(result);
});

// -------------------- PAIEMENTS --------------------

exports.tousLesPaiements = asyncHandler(async (req, res) => {
  const result = await AdminService.tousLesPaiements(req.query);
  return res.status(200).json(result);
});

exports.paiementsEchoues = asyncHandler(async (req, res) => {
  const result = await AdminService.paiementsEchoues();
  return res.status(200).json(result);
});

// -------------------- ABONNEMENT MANUEL --------------------

exports.abonnementManuel = asyncHandler(async (req, res) => {
  const result = await AdminService.abonnementManuel(req.params.vendeurId, req.user.id);
  tracer(req, 'abonnement_manuel', 'abonnement', req.params.vendeurId);
  return res.status(201).json(result);
});

exports.revoquerAbonnement = asyncHandler(async (req, res) => {
  const result = await AdminService.revoquerAbonnement(req.params.id);
  tracer(req, 'revoquer_abonnement', 'abonnement', req.params.id);
  return res.status(200).json(result);
});

// -------------------- CATÉGORIES --------------------

exports.modifierCategorie = asyncHandler(async (req, res) => {
  const result = await AdminService.modifierCategorie(req.params.id, req.body);
  return res.status(200).json(result);
});

exports.supprimerCategorie = asyncHandler(async (req, res) => {
  const result = await AdminService.supprimerCategorie(req.params.id);
  return res.status(200).json(result);
});

// -------------------- NOTIFICATION BROADCAST --------------------

exports.notificationGlobale = asyncHandler(async (req, res) => {
  const { titre, message, type, cible } = req.body;
  if (!titre || !message) throw new BadRequestError('titre et message sont requis');

  const result = await AdminService.notificationGlobale({ titre, message, type, cible });
  return res.status(201).json(result);
});

// -------------------- MODÉRATION AVANCÉE --------------------

exports.produitsEnAttente = asyncHandler(async (req, res) => {
  const result = await AdminService.produitsEnAttente();
  return res.status(200).json(result);
});

// -------------------- COMMANDES (e-commerce) --------------------

exports.toutesCommandes = asyncHandler(async (req, res) => {
  const { statut, page, limit } = req.query;
  const result = await AdminService.toutesLesCommandes({ statut, page, limit });
  return res.status(200).json(result);
});

exports.statsEcommerce = asyncHandler(async (req, res) => {
  const result = await AdminService.statsEcommerce();
  return res.status(200).json(result);
});

// -------------------- DEMANDES DE RETOUR / REMBOURSEMENT --------------------

exports.listerDemandesRetour = asyncHandler(async (req, res) => {
  const { statut, page, limit } = req.query;
  const result = await DemandeRetourService.listerDemandes({ statut, page, limit });
  return res.status(200).json({ success: true, ...result });
});

exports.traiterDemandeRetour = asyncHandler(async (req, res) => {
  const { action, reponseAdmin } = req.body;
  const demande = await DemandeRetourService.traiterDemande(req.params.id, { action, reponseAdmin });
  tracer(req, `demande_retour_${action}`, 'demande_retour', req.params.id, { reponseAdmin });
  return res.status(200).json({ success: true, demande });
});

// -------------------- LOGS D'AUDIT --------------------

exports.listerAuditLogs = asyncHandler(async (req, res) => {
  const { page, limit, adminId, action } = req.query;
  const result = await AuditService.lister({ page, limit, adminId, action });
  return res.status(200).json({ success: true, ...result });
});
