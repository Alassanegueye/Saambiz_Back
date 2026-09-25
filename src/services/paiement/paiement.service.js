// services/paiement/paiement.service.js
const { Paiement, Abonnement, Utilisateur } = require('../../models');
const sequelize = require('../../config/db');
const OrangeMoneyService = require('./orangeMoney.service');
const ConfigService = require('../config/config.service');
const { sendAbonnementConfirme } = require('../resend.service');
const { sendPushToUsers } = require('../push.service');
const { v4: uuidv4 } = require('uuid');

class PaiementService {

  // -------------------- INITIER PAIEMENT --------------------
  // type : 'abonnement' (défaut, vendeur) ou 'commande' (acheteur)
  // commandeId : requis si type === 'commande'
  static async initPaiement({ utilisateurId, methode, montant, numeroTelephone, type = 'abonnement', commandeId = null }) {
    const t = await sequelize.transaction();

    try {
      // Générer un orderId unique et stable (sera utilisé comme référence Orange)
      const orderId = `ORDER-${uuidv4()}`;

      // Créer le paiement en base avec statut pending
      const paiement = await Paiement.create({
        utilisateurId,
        methode,
        montant,
        numeroTelephone,
        type,
        commandeId,
        referencePaiement: orderId,   // on sauvegarde l'orderId tout de suite
        statut: 'pending',
      }, { transaction: t });

      let providerData = null;

      if (methode === 'orange_money') {
        // Appel Orange Money — retourne payment_url + pay_token
        const omResponse = await OrangeMoneyService.initiePaiement({
          phone: numeroTelephone,
          amount: montant,
          orderId,
        });

        // Sauvegarder le pay_token pour retrouver ce paiement lors du webhook
        paiement.transactionId = omResponse.payToken;
        paiement.metadata = {
          payToken: omResponse.payToken,
          notifToken: omResponse.notifToken,
          paymentUrl: omResponse.paymentUrl,
        };
        await paiement.save({ transaction: t });

        providerData = omResponse;
      }

      // Ajouter Wave ici si besoin :
      // if (methode === 'wave') { ... }

      await t.commit();

      return {
        paiement,
        providerData,
      };

    } catch (err) {
      await t.rollback();
      throw err;
    }
  }

  // -------------------- CONFIRMER VIA WEBHOOK --------------------
  static async confirmerPaiement({ transactionId, status, orderId }) {
    const t = await sequelize.transaction();

    try {
      // Chercher par transactionId (pay_token) OU par referencePaiement (order_id)
      let paiement = null;

      if (transactionId) {
        paiement = await Paiement.findOne({ where: { transactionId } });
      }

      if (!paiement && orderId) {
        paiement = await Paiement.findOne({ where: { referencePaiement: orderId } });
      }

      if (!paiement) {
        throw new Error("Paiement introuvable — transactionId ou orderId inconnu");
      }

      // Idempotence : si déjà traité, ne rien faire
      if (paiement.statut === 'success' || paiement.statut === 'failed') {
        await t.rollback();
        return paiement;
      }

      const isSuccess = status === 'SUCCESS' || status === 'success';

      paiement.statut = isSuccess ? 'success' : 'failed';
      paiement.datePaiement = new Date();
      await paiement.save({ transaction: t });   // maintenant dans la transaction

      // Si paiement réussi ET qu'il règle une COMMANDE → marquer payée + décrémenter le stock
      if (isSuccess && paiement.type === 'commande') {
        if (paiement.commandeId) {
          // require paresseux pour éviter tout cycle de dépendance
          const CommandeService = require('../commandes/commande.service');
          await CommandeService.marquerCommandePayee(paiement.commandeId, t);
        }
        await t.commit();
        return paiement;
      }

      // Si paiement réussi (abonnement) → vérifier montant puis créer l'abonnement
      if (isSuccess) {
        const prixRequis = await ConfigService.getPrixAbonnement();
        if (parseFloat(paiement.montant) < prixRequis) {
          paiement.statut = 'failed';
          paiement.metadata = {
            ...(paiement.metadata || {}),
            raisonEchec: `Montant insuffisant : ${paiement.montant} FCFA reçu, ${prixRequis} FCFA requis`,
          };
          await paiement.save({ transaction: t });
          await t.commit();
          return paiement;
        }

        const dateDebut = new Date();
        const dateFin = new Date();
        dateFin.setMonth(dateFin.getMonth() + 1);

        const abonnement = await Abonnement.create({
          utilisateurId: paiement.utilisateurId,
          type: 'mensuel',
          dateDebut,
          dateFin,
          montant: paiement.montant,
          statut: 'actif',
        }, { transaction: t });

        // Lier l'abonnement au paiement
        paiement.abonnementId = abonnement.id;
        await paiement.save({ transaction: t });

        // Notifications en arrière-plan après commit
        const vendeur = await Utilisateur.findByPk(paiement.utilisateurId, {
          attributes: ['id', 'nom', 'prenom', 'email']
        });
        if (vendeur) {
          // Email de confirmation
          sendAbonnementConfirme({
            to: vendeur.email,
            nom: `${vendeur.prenom} ${vendeur.nom}`,
            montant: paiement.montant,
            dateDebut,
            dateFin
          }).catch(() => {});

          // Push notification
          sendPushToUsers(vendeur.id, {
            title: '✅ Abonnement activé !',
            body: `Votre abonnement Jëndal est actif jusqu'au ${dateFin.toLocaleDateString('fr-FR')}.`,
            data: { type: 'abonnement', abonnementId: abonnement.id }
          }).catch(() => {});
        }
      }

      await t.commit();
      return paiement;

    } catch (err) {
      await t.rollback();
      throw err;
    }
  }

  // -------------------- RECUPERER UN PAIEMENT --------------------
  static async getPaiement(paiementId) {
    return await Paiement.findByPk(paiementId, {
      include: [{ model: Abonnement }],
    });
  }

  // -------------------- HISTORIQUE UTILISATEUR --------------------
  static async getHistorique(utilisateurId) {
    return await Paiement.findAll({
      where: { utilisateurId },
      order: [['createdAt', 'DESC']],
      include: [{ model: Abonnement }],
    });
  }
}

module.exports = PaiementService;