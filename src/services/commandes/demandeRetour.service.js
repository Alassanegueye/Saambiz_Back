// services/commandes/demandeRetour.service.js
// Workflow de retour / remboursement d'une commande livrée
const { DemandeRetour, Commande, Utilisateur } = require('../../models');
const NotificationService = require('../notifications/notification.service');
const { sendPushToUsers } = require('../push.service');
const { BadRequestError, ForbiddenError, NotFoundError } = require('../../errors/AppError');

const DEFAULT_PAGE_SIZE = 20;

function paginate(page = 1, limit = DEFAULT_PAGE_SIZE) {
  return {
    limit: parseInt(limit),
    offset: (parseInt(page) - 1) * parseInt(limit),
  };
}

class DemandeRetourService {

  // -------------------- ACHETEUR : créer une demande de retour --------------------
  static async creerDemande(commandeId, acheteurId, raison) {
    if (!raison || !raison.trim()) {
      throw new BadRequestError('La raison du retour est requise');
    }

    const commande = await Commande.findByPk(commandeId);
    if (!commande) throw new NotFoundError('Commande introuvable');
    if (commande.acheteurId !== acheteurId) {
      throw new ForbiddenError('Cette commande ne vous appartient pas');
    }
    if (commande.statut !== 'livree') {
      throw new BadRequestError('Une demande de retour ne peut être faite que sur une commande livrée.');
    }

    const existante = await DemandeRetour.findOne({
      where: { commandeId, statut: 'en_attente' },
    });
    if (existante) {
      throw new BadRequestError('Une demande de retour est déjà en attente pour cette commande.');
    }

    const demande = await DemandeRetour.create({ commandeId, acheteurId, raison });
    return demande;
  }

  // -------------------- ADMIN : liste paginée --------------------
  static async listerDemandes({ statut, page = 1, limit = DEFAULT_PAGE_SIZE } = {}) {
    const where = {};
    if (statut) where.statut = statut;

    const { limit: l, offset } = paginate(page, limit);
    const { rows, count } = await DemandeRetour.findAndCountAll({
      where,
      include: [
        { model: Commande, as: 'commande', attributes: ['id', 'referenceCommande', 'montantTotal', 'statut', 'statutPaiement'] },
        { model: Utilisateur, as: 'acheteur', attributes: ['id', 'nom', 'prenom', 'telephone', 'email'] },
      ],
      order: [['createdAt', 'DESC']],
      limit: l,
      offset,
    });

    return {
      demandes: rows,
      total: count,
      page: parseInt(page),
      pages: Math.ceil(count / l),
    };
  }

  // -------------------- ADMIN : traiter une demande --------------------
  static async traiterDemande(demandeId, { action, reponseAdmin }) {
    if (!['accepter', 'refuser'].includes(action)) {
      throw new BadRequestError("L'action doit être 'accepter' ou 'refuser'");
    }

    const demande = await DemandeRetour.findByPk(demandeId);
    if (!demande) throw new NotFoundError('Demande de retour introuvable');
    if (demande.statut !== 'en_attente') {
      throw new BadRequestError('Cette demande a déjà été traitée.');
    }

    const commande = await Commande.findByPk(demande.commandeId);
    if (!commande) throw new NotFoundError('Commande introuvable');

    if (action === 'accepter') {
      demande.statut = 'acceptee';
      demande.reponseAdmin = reponseAdmin || null;
      await demande.save();

      commande.statutPaiement = 'rembourse';
      await commande.save();

      await DemandeRetourService._notifierAcheteur(
        commande.acheteurId,
        'Retour accepté',
        `Votre demande de retour pour la commande ${commande.referenceCommande} a été acceptée. Vous serez remboursé.`,
      );
    } else {
      demande.statut = 'refusee';
      demande.reponseAdmin = reponseAdmin || null;
      await demande.save();

      await DemandeRetourService._notifierAcheteur(
        commande.acheteurId,
        'Retour refusé',
        `Votre demande de retour pour la commande ${commande.referenceCommande} a été refusée.${reponseAdmin ? ' Motif : ' + reponseAdmin : ''}`,
      );
    }

    return demande;
  }

  // -------------------- NOTIFICATION --------------------
  static async _notifierAcheteur(acheteurId, titre, message) {
    await NotificationService.creerNotification({
      utilisateurId: acheteurId, titre, message, type: 'commande',
    });
    sendPushToUsers(acheteurId, { title: titre, body: message, data: { type: 'commande' } }).catch(() => {});
  }
}

module.exports = DemandeRetourService;
