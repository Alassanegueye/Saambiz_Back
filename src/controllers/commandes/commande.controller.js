// controllers/commandes/commande.controller.js
const CommandeService = require('../../services/commandes/commande.service');
const PaiementService = require('../../services/paiement/paiement.service');
const DemandeRetourService = require('../../services/commandes/demandeRetour.service');
const AccueilService = require('../../services/acheteurs/accueil.service');
const { Produit, Categorie } = require('../../models');
const asyncHandler = require('../../middlewares/asyncHandler');
const { BadRequestError, ForbiddenError } = require('../../errors/AppError');

/**
 * Un achat est le signal le plus fort dont on dispose : il pèse dix fois plus
 * qu'une simple consultation dans les propositions de l'accueil. On remonte la
 * catégorie de chaque produit commandé, sans jamais bloquer la commande.
 */
async function nourrirAffinites(acheteurId, items) {
  try {
    const ids = (items || []).map((i) => i.produitId).filter(Boolean);
    if (!ids.length) return;
    const produits = await Produit.findAll({
      where: { id: ids },
      include: [{ model: Categorie, as: 'categorie', attributes: ['nom'], required: false }],
    });
    for (const p of produits) {
      const nom = p.categorie?.nom || null;
      if (nom) await AccueilService.enregistrerAffinite(acheteurId, nom, 'achat');
    }
  } catch {
    // Personnalisation best-effort.
  }
}

// -------------------- ACHETEUR : créer une commande --------------------
exports.creerCommande = asyncHandler(async (req, res) => {
  const acheteurId = req.user.id;
  const {
    items,
    modeLivraison,
    modePaiement,
    adresseLivraison,
    numeroTelephone,
    note,
  } = req.body;

  const commande = await CommandeService.creerCommande({
    acheteurId,
    items,
    modeLivraison,
    modePaiement,
    adresseLivraison,
    numeroTelephone,
    note,
  });

  nourrirAffinites(acheteurId, items).catch(() => {});

  return res.status(201).json({ success: true, commande });
});

// -------------------- ACHETEUR : payer une commande en ligne --------------------
exports.payerCommande = asyncHandler(async (req, res) => {
  const acheteurId = req.user.id;
  const { id } = req.params;
  const { methode, numeroTelephone } = req.body;

  // Le service refuse déjà une commande qui n'appartient ni à l'acheteur ni au
  // vendeur ; on redouble ici parce que payer est réservé à l'acheteur.
  const commande = await CommandeService.getCommandePourUtilisateur(id, acheteurId);

  if (commande.acheteurId !== acheteurId) {
    throw new ForbiddenError('Accès refusé');
  }
  if (commande.statutPaiement === 'paye') {
    throw new BadRequestError('Commande déjà payée');
  }
  if (commande.statut === 'annulee') {
    throw new BadRequestError('Commande annulée');
  }
  if (!['orange_money', 'wave'].includes(methode)) {
    throw new BadRequestError('Méthode de paiement non supportée');
  }

  const result = await PaiementService.initPaiement({
    utilisateurId: acheteurId,
    methode,
    montant: parseInt(commande.montantTotal, 10),
    numeroTelephone: numeroTelephone || commande.numeroTelephone,
    type: 'commande',
    commandeId: commande.id,
  });

  return res.status(200).json({
    success: true,
    message: 'Paiement initié. Redirigez le client vers paymentUrl.',
    paiementId: result.paiement.id,
    statut: result.paiement.statut,
    paymentUrl: result.providerData?.paymentUrl || null,
  });
});

// -------------------- ACHETEUR : mes commandes --------------------
exports.mesCommandes = asyncHandler(async (req, res) => {
  const commandes = await CommandeService.mesCommandes(req.user.id, { statut: req.query.statut });
  return res.status(200).json({ success: true, commandes });
});

// -------------------- ACHETEUR/VENDEUR : détail d'une commande --------------------
exports.getCommande = asyncHandler(async (req, res) => {
  const commande = await CommandeService.getCommandePourUtilisateur(req.params.id, req.user.id);
  return res.status(200).json({ success: true, commande });
});

// -------------------- ACHETEUR : annuler --------------------
exports.annulerCommande = asyncHandler(async (req, res) => {
  const commande = await CommandeService.annulerCommande(req.params.id, req.user.id);
  return res.status(200).json({ success: true, commande });
});

// -------------------- VENDEUR : commandes reçues --------------------
exports.commandesVendeur = asyncHandler(async (req, res) => {
  const commandes = await CommandeService.commandesVendeur(req.user.id, {
    statut: req.query.statut,
    origine: req.query.origine,
  });
  return res.status(200).json({ success: true, commandes });
});

// -------------------- VENDEUR : faire avancer le statut --------------------
exports.changerStatut = asyncHandler(async (req, res) => {
  const { statut } = req.body;
  if (!statut) {
    throw new BadRequestError('Le nouveau statut est requis');
  }
  const commande = await CommandeService.changerStatut(req.params.id, req.user.id, statut);
  return res.status(200).json({ success: true, commande });
});

// -------------------- ACHETEUR : demander un retour/remboursement --------------------
exports.demanderRetour = asyncHandler(async (req, res) => {
  const { raison } = req.body;
  const demande = await DemandeRetourService.creerDemande(req.params.id, req.user.id, raison);
  return res.status(201).json({ success: true, demande });
});
