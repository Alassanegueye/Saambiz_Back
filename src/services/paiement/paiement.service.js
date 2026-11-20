// services/paiement/paiement.service.js
const WaveService = require('./wave.service');
const { Paiement, Abonnement, Utilisateur } = require('../../models');
const sequelize = require('../../config/db');
const OrangeMoneyService = require('./orangeMoney.service');
const ConfigService = require('../config/config.service');
const { sendAbonnementConfirme } = require('../resend.service');
const NotificationService = require('../notifications/notification.service');
const { v4: uuidv4 } = require('uuid');
const { NotFoundError } = require('../../errors/AppError');
const echecIgnore = require('../../utils/echecIgnore');

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
          // Orange Money attend le numéro national (9 chiffres) : les numéros
          // sont enregistrés au format international (+221…).
          phone: String(numeroTelephone || '').replace(/[^\d+]/g, '').replace(/^(\+|00)?221(?=\d{9}$)/, ''),
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

      if (methode === 'wave') {
        const session = await WaveService.creerSession({ montant, reference: orderId });
        paiement.transactionId = session.sessionId;
        paiement.metadata = { paymentUrl: session.paymentUrl };
        await paiement.save({ transaction: t });
        providerData = session;
      }

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
  static async confirmerPaiement({ transactionId, status, orderId, montantRecu = null }) {
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
        throw new NotFoundError("Paiement introuvable — transactionId ou orderId inconnu");
      }

      // Idempotence : si déjà traité, ne rien faire
      if (paiement.statut === 'success' || paiement.statut === 'failed') {
        await t.rollback();
        return paiement;
      }

      // Un montant inférieur à celui demandé n'est pas un paiement réussi.
      const montantInsuffisant =
        montantRecu !== null && Number(montantRecu) < Number(paiement.montant);
      const isSuccess = (status === 'SUCCESS' || status === 'success') && !montantInsuffisant;

      paiement.statut = isSuccess ? 'success' : 'failed';
      paiement.datePaiement = new Date();
      await paiement.save({ transaction: t });   // maintenant dans la transaction

      // UN PAIEMENT QUI ÉCHOUE SE DIT. Sans cela, la commande resterait « en
      // attente » sans un mot : le client ne saurait pas si son argent est
      // parti, s'il doit recommencer, ni combien de temps attendre. Il
      // appellerait la boutique, ou il abandonnerait.
      if (!isSuccess) {
        PaiementService._prevenirEchec(paiement, t);
      }

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
          // APRÈS LE COMMIT, ET SEULEMENT S'IL A LIEU.
          //
          // Envoyés depuis la transaction encore ouverte, l'e-mail et le push
          // annonceraient « Abonnement activé » même si le commit échouait
          // ensuite : le vendeur croirait avoir un abonnement que la base n'a
          // jamais enregistré, et il faudrait le rembourser.
          t.afterCommit(() => {
            // L'ABONNEMENT GARDE SON E-MAIL : c'est une facture, avec un
            // montant et des dates, et un vendeur doit pouvoir la retrouver
            // ailleurs que dans l'application. La notification s'y ajoute,
            // elle ne le remplace pas — contrairement aux étapes d'une
            // commande, où elle a pris toute la place.
            sendAbonnementConfirme({
              to: vendeur.email,
              nom: `${vendeur.prenom} ${vendeur.nom}`,
              montant: paiement.montant,
              dateDebut,
              dateFin
            }).catch(echecIgnore('e-mail abonnement confirmé'));

            // `creerNotification` fait les trois d'un coup : la ligne dans le
            // centre de notifications (donc le compteur de non-lus), l'envoi
            // temps réel, et le push sur le téléphone. Un `sendPushToUsers`
            // direct ne faisait que le dernier : le vendeur recevait la
            // bannière, puis ne retrouvait rien dans l'application.
            NotificationService.creerNotification({
              utilisateurId: vendeur.id,
              titre: '✅ Abonnement activé',
              message: `Votre abonnement est actif jusqu'au ${dateFin.toLocaleDateString('fr-FR')}.`,
              type: 'abonnement',
              data: { abonnementId: abonnement.id },
            }).catch(echecIgnore('notification abonnement activé'));
          });
        }
      }

      await t.commit();
      return paiement;

    } catch (err) {
      await t.rollback();
      throw err;
    }
  }

  /**
   * Prévient du refus d'un paiement, après le commit seulement.
   *
   * Pour une commande, c'est l'acheteur qu'on prévient, et la notification
   * ouvre sa commande — c'est de là qu'il peut repayer. Pour un abonnement,
   * c'est le vendeur, et elle ouvre « Mon abonnement ».
   */
  static _prevenirEchec(paiement, t) {
    t.afterCommit(async () => {
      try {
        const NotificationService = require('../notifications/notification.service');
        const motif = paiement.metadata?.raisonEchec;

        if (paiement.type === 'commande' && paiement.commandeId) {
          const { Commande } = require('../../models');
          const commande = await Commande.findByPk(paiement.commandeId, {
            attributes: ['id', 'acheteurId', 'referenceCommande'],
          });
          // Commande passée sans compte : personne à joindre dans
          // l'application. Le site de la boutique affiche le refus.
          if (!commande?.acheteurId) return;

          await NotificationService.creerNotification({
            utilisateurId: commande.acheteurId,
            titre: 'Paiement refusé',
            message: `Le paiement de la commande ${commande.referenceCommande} n'a pas abouti.`
              + `${motif ? ` ${motif}.` : ''} Vous pouvez réessayer depuis votre commande.`,
            type: 'commande',
            data: {
              commandeId: commande.id,
              reference: commande.referenceCommande || '',
              pourVendeur: false,
            },
          });
          return;
        }

        await NotificationService.creerNotification({
          utilisateurId: paiement.utilisateurId,
          titre: 'Paiement refusé',
          message: `Le paiement de votre abonnement n'a pas abouti.${motif ? ` ${motif}.` : ''}`
            + ' Vous pouvez réessayer depuis votre abonnement.',
          type: 'abonnement',
          data: { paiementId: paiement.id },
        });
      } catch (_) {
        // Un refus de paiement reste enregistré même si la notification part mal.
      }
    });
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