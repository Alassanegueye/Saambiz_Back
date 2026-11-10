// controllers/commandes/commande.controller.js
const CommandeService = require('../../services/commandes/commande.service');
const PaiementService = require('../../services/paiement/paiement.service');
const DemandeRetourService = require('../../services/commandes/demandeRetour.service');
const AccueilService = require('../../services/acheteurs/accueil.service');
const asyncHandler = require('../../middlewares/asyncHandler');
const { BadRequestError, ForbiddenError } = require('../../errors/AppError');

// Un achat est le signal le plus fort dont on dispose pour les propositions de
// l'accueil. Le calcul (catégorie de chaque produit) vit dans AccueilService :
// ce contrôleur interrogeait auparavant les modèles lui-même.
const nourrirAffinites = (acheteurId, items) =>
  AccueilService.enregistrerAffinitesAchat(acheteurId, items);

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
  if (commande.statut === 'en_attente') {
    throw new BadRequestError('Le vendeur doit d\'abord accepter votre commande.');
  }
  if (commande.statut !== 'acceptee') {
    throw new BadRequestError('Cette commande ne peut plus être payée.');
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
  const { id } = await CommandeService.annulerCommande(req.params.id, req.user.id);
  const commande = await CommandeService.getCommandeComplete(id);
  return res.status(200).json({ success: true, commande });
});

// -------------------- VENDEUR : commandes reçues --------------------
// -------------------- VENDEUR : saisir une commande --------------------
// Une commande prise hors de l'application (téléphone, WhatsApp, en
// boutique). Le client n'a pas forcément de compte : ses coordonnées sont
// portées par la commande, comme pour une commande venue du site.
exports.creerCommandeVendeur = asyncHandler(async (req, res) => {
  // Chargé ici : le service vitrine dépend lui-même du service commandes.
  const VitrineService = require('../../services/vitrine/vitrine.service');
  const { Produit } = require('../../models');
  const { Op } = require('sequelize');

  const vendeurId = req.user.id;
  const { client = {}, items, modeLivraison = 'retrait', adresseLivraison, note } = req.body;

  const telephone = VitrineService.normaliserTelephone(client.telephone);
  if (!VitrineService.estTelephoneValide(telephone)) {
    throw new BadRequestError('Le numéro de téléphone du client est invalide. Exemple : 77 123 45 67.');
  }
  if (modeLivraison === 'livraison' && !String(adresseLivraison || '').trim()) {
    throw new BadRequestError('Indiquez l\'adresse de livraison.');
  }

  // Le vendeur ne saisit que ses propres produits.
  const ids = [...new Set(items.map((i) => i.produitId))];
  const nbAMoi = await Produit.count({ where: { id: { [Op.in]: ids }, vendeurId } });
  if (nbAMoi !== ids.length) {
    throw new ForbiddenError('Vous ne pouvez enregistrer que vos propres produits.');
  }

  const email = String(client.email || '').trim().toLowerCase();
  const commande = await CommandeService.creerCommande({
    acheteurId: null,
    client: {
      prenom: String(client.prenom).trim().slice(0, 120),
      nom: String(client.nom || '').trim().slice(0, 120) || null,
      telephone,
      email: email || null,
    },
    items,
    modeLivraison,
    // Saisie par le vendeur : le règlement se fait de la main à la main.
    modePaiement: 'a_la_livraison',
    adresseLivraison: adresseLivraison ? String(adresseLivraison).trim().slice(0, 240) : null,
    numeroTelephone: telephone,
    note: note ? String(note).trim().slice(0, 500) : null,
    origine: 'dashboard',
  });

  return res.status(201).json({ success: true, commande });
});

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
  const { id } = await CommandeService.changerStatut(req.params.id, req.user.id, statut);
  // La commande complète : l'écran affiche ses articles à partir de cette réponse.
  const commande = await CommandeService.getCommandeComplete(id);
  return res.status(200).json({ success: true, commande });
});

// -------------------- VENDEUR : confirmer le paiement reçu à la livraison --------------------
exports.confirmerPaiement = asyncHandler(async (req, res) => {
  const { id } = await CommandeService.confirmerPaiementVendeur(req.params.id, req.user.id);
  const commande = await CommandeService.getCommandeComplete(id);
  return res.status(200).json({ success: true, commande });
});

// -------------------- ACHETEUR : demander un retour/remboursement --------------------
exports.demanderRetour = asyncHandler(async (req, res) => {
  const { raison } = req.body;
  const demande = await DemandeRetourService.creerDemande(req.params.id, req.user.id, raison);
  return res.status(201).json({ success: true, demande });
});
