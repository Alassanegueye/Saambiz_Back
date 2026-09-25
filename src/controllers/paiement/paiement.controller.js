// controllers/paiement/paiement.controller.js
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
exports.webhook = async (req, res) => {
  try {
    console.log("[WEBHOOK] Notification Orange Money reçue:", JSON.stringify(req.body));

    // Valider que la notification vient bien d'Orange
    const estValide = OrangeMoneyService.validerSignature(req);
    if (!estValide) {
      console.warn("[WEBHOOK] Signature invalide ou body malformé");
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
    console.error("[WEBHOOK] Erreur traitement:", err.message);
    // On renvoie quand même 200 pour éviter qu'Orange retry en boucle sur une erreur interne
    return res.status(200).json({ success: false, error: err.message });
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
