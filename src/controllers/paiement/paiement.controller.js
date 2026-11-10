// controllers/paiement/paiement.controller.js
const logger = require('../../utils/logger');
const WaveService = require('../../services/paiement/wave.service');
const PaiementService = require('../../services/paiement/paiement.service');
const OrangeMoneyService = require('../../services/paiement/orangeMoney.service');
const asyncHandler = require('../../middlewares/asyncHandler');
const { BadRequestError, ForbiddenError, NotFoundError } = require('../../errors/AppError');

const METHODES_SUPPORTEES = ['orange_money', 'wave'];

// -------------------- INITIER LE PAIEMENT --------------------
exports.payer = asyncHandler(async (req, res) => {
  const utilisateurId = req.user.id;
  const { methode, montant, numeroTelephone } = req.body;

  // Validation basique
  if (!methode || !montant || !numeroTelephone) {
    throw new BadRequestError('Champs requis manquants : methode, montant, numeroTelephone');
  }

  if (!METHODES_SUPPORTEES.includes(methode)) {
    throw new BadRequestError('Méthode de paiement non supportée');
  }

  if (montant <= 0) {
    throw new BadRequestError('Le montant doit être positif');
  }

  const result = await PaiementService.initPaiement({
    utilisateurId,
    methode,
    montant,
    numeroTelephone,
  });

  return res.status(200).json({
    success: true,
    message: "Paiement initié. Redirigez le client vers payment_url.",
    paiementId: result.paiement.id,
    statut: result.paiement.statut,
    // URL Orange Money vers laquelle rediriger le client
    paymentUrl: result.providerData?.paymentUrl || null,
  });
});

// -------------------- WEBHOOK ORANGE MONEY --------------------
// Route publique — Orange appelle ce endpoint automatiquement.
//
// Seul contrôleur qui garde son propre try/catch : Orange rejoue la
// notification tant qu'il ne reçoit pas un 200. Laisser l'erreur partir dans
// le gestionnaire global produirait un 500, donc une boucle de renvois sur
// une panne que le renvoi ne corrigera pas.
// Wave exige une réponse sous cinq secondes et renvoie la notification tant
// qu'il ne reçoit pas de 2xx. La confirmation est idempotente : un doublon ne
// change rien.
exports.webhookWave = async (req, res) => {
  if (!WaveService.signatureValide(req.headers['wave-signature'], req.rawBody)) {
    return res.status(401).json({ success: false, message: 'Signature invalide' });
  }
  const { type, data } = req.body || {};
  // Un échec ne clôt pas la session : le client peut réessayer.
  if (type !== 'checkout.session.completed' || data?.payment_status !== 'succeeded') {
    return res.status(200).json({ success: true });
  }
  try {
    await PaiementService.confirmerPaiement({
      transactionId: data.id,
      status: 'success',
      orderId: data.client_reference,
      montantRecu: data.amount,
    });
    return res.status(200).json({ success: true });
  } catch (err) {
    logger.error('[WEBHOOK WAVE] Échec de confirmation', { message: err.message });
    return res.status(500).json({ success: false });
  }
};

exports.webhook = async (req, res) => {
  try {
    // Le corps entier était imprimé ici, en clair et sans condition : il
    // porte `pay_token`, le jeton de la transaction. Un journal de production
    // se lit chez l'hébergeur, dans l'agrégateur de logs, et dans tout export
    // qui en sort. Seuls les identifiants nécessaires au diagnostic sont
    // conservés, et par le journal structuré du projet plutôt que par
    // `console`, qui échappe à ses règles de niveau et de rédaction.
    logger.info('webhook_orange_recu', {
      orderId: req.body?.order_id,
      status: req.body?.status,
    });

    // Valider que la notification vient bien d'Orange
    const estValide = OrangeMoneyService.validerSignature(req);
    if (!estValide) {
      logger.warn('webhook_orange_signature_invalide', {
        orderId: req.body?.order_id,
      });
      return res.status(400).json({ success: false, message: "Notification invalide" });
    }

    // Orange Money envoie selon leur doc :
    // { status: "SUCCESS" | "FAILED", order_id: "...", pay_token: "...", ... }
    const {
      status,
      order_id,
      pay_token,
      txnid,             // ID transaction côté Orange
    } = req.body;

    await PaiementService.confirmerPaiement({
      transactionId: pay_token || txnid || null,
      status,
      orderId: order_id,
    });

    // Orange attend un 200 pour considérer la notification comme reçue
    return res.status(200).json({ success: true });

  } catch (err) {
    logger.error('webhook_orange_erreur', {
      message: err.message,
      orderId: req.body?.order_id,
    });
    // On renvoie quand même 200 pour éviter qu'Orange retry en boucle sur une erreur interne
    // Le message interne n'est pas renvoyé : ce point d'entrée est public par
    // construction, et un message d'erreur Sequelize nomme les tables et les
    // colonnes. Le 200 reste, lui, volontaire — il évite qu'Orange rejoue la
    // notification en boucle sur une panne que le rejeu ne corrigera pas.
    return res.status(200).json({ success: false });
  }
};

// -------------------- CONSULTER UN PAIEMENT --------------------
exports.getPaiement = asyncHandler(async (req, res) => {
  const { paiementId } = req.params;

  const paiement = await PaiementService.getPaiement(paiementId);
  if (!paiement) throw new NotFoundError('Paiement introuvable');

  // Vérifier que le paiement appartient bien à cet utilisateur
  if (paiement.utilisateurId !== req.user.id) {
    throw new ForbiddenError('Accès refusé');
  }

  return res.status(200).json({ success: true, paiement });
});

// -------------------- HISTORIQUE DES PAIEMENTS --------------------
exports.getHistorique = asyncHandler(async (req, res) => {
  const paiements = await PaiementService.getHistorique(req.user.id);
  return res.status(200).json({ success: true, paiements });
});
