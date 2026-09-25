const { Notification, Utilisateur, Favori, Boutique } = require('../../models');
const { getIO } = require('../socket.service');
const { sendPushToUsers } = require('../push.service');

class NotificationService {

  static async creerNotification({ utilisateurId, titre, message, type }) {
    const notification = await Notification.create({ utilisateurId, titre, message, type });
    try {
      getIO().to('user:' + utilisateurId).emit('notification:new', notification);
    } catch (_) { /* Socket.IO pas encore initialisé — on ignore silencieusement */ }
    // Push FCM best-effort (ne bloque pas si Firebase non configuré)
    sendPushToUsers(utilisateurId, { title: titre, body: message, data: { type } }).catch(() => {});
    return notification;
  }

  /**
   * Notifie une liste d'utilisateurs : persiste en base, émet en temps réel (Socket.IO)
   * et envoie un push FCM. Best-effort sur le temps réel et le push.
   */
  static async notifierUtilisateurs(userIds, titre, message, type, data = {}) {
    const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean))];
    if (!ids.length) return { destinataires: 0 };

    const notifications = ids.map(id => ({ utilisateurId: id, titre, message, type }));
    const crees = await Notification.bulkCreate(notifications, { returning: true });

    // Temps réel
    try {
      const io = getIO();
      crees.forEach(n => io.to('user:' + n.utilisateurId).emit('notification:new', n));
    } catch (_) { /* Socket.IO indisponible */ }

    // Push FCM groupé
    sendPushToUsers(ids, { title: titre, body: message, data: { type, ...data } }).catch(() => {});

    return { destinataires: ids.length };
  }

  /**
   * 🔔 Notifie les abonnés d'une boutique ayant activé la cloche.
   */
  static async notifierAbonnesBoutique(boutiqueId, titre, message, type, data = {}) {
    const abonnes = await Favori.findAll({
      where: { boutiqueId, clocheActive: true },
      attributes: ['acheteurId'],
    });
    const ids = abonnes.map(a => a.acheteurId);
    return this.notifierUtilisateurs(ids, titre, message, type, { boutiqueId, ...data });
  }

  /**
   * 🔔 Notifie les abonnés (cloche active) de toutes les boutiques d'un vendeur.
   * Utilisé lors de la publication d'un nouveau produit ou d'une promotion.
   */
  static async notifierAbonnesDuVendeur(vendeurId, titre, message, type, data = {}) {
    const boutiques = await Boutique.findAll({
      where: { vendeurId },
      attributes: ['id'],
    });
    if (!boutiques.length) return { destinataires: 0 };

    const boutiqueIds = boutiques.map(b => b.id);
    const abonnes = await Favori.findAll({
      where: { boutiqueId: boutiqueIds, clocheActive: true },
      attributes: ['acheteurId'],
    });
    const ids = abonnes.map(a => a.acheteurId);
    return this.notifierUtilisateurs(ids, titre, message, type, data);
  }

  static async mesNotifications(userId) {
    return await Notification.findAll({
      where: { utilisateurId: userId },
      order: [['createdAt', 'DESC']],
      limit: 50
    });
  }

  static async marquerLue(notifId, userId) {
    const notif = await Notification.findOne({ where: { id: notifId, utilisateurId: userId } });
    if (!notif) return { success: false, message: 'Notification introuvable' };
    await notif.update({ lue: true });
    return { success: true, message: 'Notification marquée comme lue' };
  }

  static async marquerToutesLues(userId) {
    await Notification.update({ lue: true }, { where: { utilisateurId: userId, lue: false } });
    return { success: true, message: 'Toutes les notifications marquées comme lues' };
  }

  static async getNbNonLues(userId) {
    const count = await Notification.count({ where: { utilisateurId: userId, lue: false } });
    return { nonLues: count };
  }

  static async notifierTousAcheteurs(titre, message, type) {
    const acheteurs = await Utilisateur.findAll({
      where: { role: 'Acheteur', statut: 'actif' },
      attributes: ['id']
    });

    const notifications = acheteurs.map(a => ({
      utilisateurId: a.id,
      titre,
      message,
      type
    }));

    if (notifications.length > 0) {
      await Notification.bulkCreate(notifications);
    }
  }
}

module.exports = NotificationService;
