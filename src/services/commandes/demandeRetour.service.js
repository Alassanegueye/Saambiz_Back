// services/commandes/demandeRetour.service.js
// Workflow de retour / remboursement d'une commande livrée
const { DemandeRetour, Commande, Utilisateur, Boutique } = require('../../models');
const NotificationService = require('../notifications/notification.service');
const { BadRequestError, ForbiddenError, NotFoundError } = require('../../errors/AppError');

// Dix par page, et une borne haute : la copie locale de ce calcul prenait
// le `limit` de la requete tel quel, donc `?limit=100000` chargeait toute la
// table. Le helper partage plafonne a cent.
const { paginate, LIMITE_DEFAUT } = require('../../utils/paginate');
const echecIgnore = require('../../utils/echecIgnore');
const { Op } = require('sequelize');

const DEFAULT_PAGE_SIZE = LIMITE_DEFAUT;

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

    // LE VENDEUR EST PRÉVENU. Personne ne l'était : la demande attendait dans
    // l'administration, et le vendeur apprenait le retour de sa marchandise
    // en la voyant revenir. C'est lui qui connaît le produit et le client ;
    // il doit pouvoir répondre avant que l'administration ne tranche.
    DemandeRetourService._prevenirVendeur(commande, acheteurId, raison).catch(echecIgnore('alerte demande de retour au vendeur'));

    return demande;
  }

  /** Notification au vendeur : une demande de retour vient d'arriver. */
  static async _prevenirVendeur(commande, acheteurId, raison) {
    if (!commande.vendeurId) return;
    const acheteur = acheteurId
      ? await Utilisateur.findByPk(acheteurId, { attributes: ['prenom', 'nom'] })
      : null;
    const nom = acheteur
      ? `${acheteur.prenom || ''} ${acheteur.nom || ''}`.trim()
      : 'Un client';
    const motif = String(raison || '').trim();

    await NotificationService.creerNotification({
      utilisateurId: commande.vendeurId,
      titre: 'Demande de retour',
      message: `${nom || 'Un client'} demande le retour de la commande ${commande.referenceCommande}.`
        + `${motif ? ` Motif : ${motif}` : ''}`,
      type: 'commande',
      data: {
        commandeId: commande.id,
        reference: commande.referenceCommande || '',
        pourVendeur: true,
      },
    });
  }

  // -------------------- ADMIN : liste paginée --------------------
  /**
   * @param {Object} filtres
   * @param {string} [filtres.recherche] motif cherché dans la raison du
   *   retour, la référence de la commande ou le nom de l'acheteur. Sans lui,
   *   le back-office ne pouvait chercher que dans la page affichée.
   */
  static async listerDemandes({ statut, recherche, page = 1, limit = DEFAULT_PAGE_SIZE } = {}) {
    const where = {};
    if (statut) where.statut = statut;

    const terme = String(recherche || '').trim();
    if (terme) {
      // `%` et `_` échappés : saisis tels quels, ils ramèneraient tout.
      const motif = `%${terme.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      // `$table.colonne$` cherche dans les modèles joints. Les deux jointures
      // sont des `belongsTo` : Sequelize produit de simples LEFT JOIN, sans
      // sous-requête qui ferait mentir la pagination.
      where[Op.or] = [
        { raison: { [Op.iLike]: motif } },
        { '$commande.reference_commande$': { [Op.iLike]: motif } },
        { '$acheteur.nom$': { [Op.iLike]: motif } },
        { '$acheteur.prenom$': { [Op.iLike]: motif } },
      ];
    }

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
      // Nécessaire dès qu'une clause porte sur une table jointe : sans cela
      // Sequelize applique la limite dans une sous-requête où la jointure
      // n'existe pas encore.
      subQuery: false,
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
        commande.vendeurId,
      );
    } else {
      demande.statut = 'refusee';
      demande.reponseAdmin = reponseAdmin || null;
      await demande.save();

      await DemandeRetourService._notifierAcheteur(
        commande.acheteurId,
        'Retour refusé',
        `Votre demande de retour pour la commande ${commande.referenceCommande} a été refusée.${reponseAdmin ? ' Motif : ' + reponseAdmin : ''}`,
        commande.vendeurId,
      );
    }

    return demande;
  }

  // -------------------- NOTIFICATION --------------------
  static async _notifierAcheteur(acheteurId, titre, message, vendeurId = null) {
    // Au nom de la boutique : son logo accompagne le push. (Le push part
    // depuis NotificationService : un second envoi ici le doublait.)
    let image;
    if (vendeurId) {
      const b = await Boutique.findOne({ where: { vendeurId }, attributes: ['logo'] });
      image = b?.logo || undefined;
    }
    await NotificationService.creerNotification({
      utilisateurId: acheteurId, titre, message, type: 'commande', image,
    });
  }
}

module.exports = DemandeRetourService;
