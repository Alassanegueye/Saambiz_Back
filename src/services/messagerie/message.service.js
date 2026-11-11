const { Message, MessageSite, Utilisateur } = require('../../models');
const { Op, fn, col, literal } = require('sequelize');
const sequelize = require('../../config/db');
const { getIO } = require('../socket.service');

const FORMAT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class MessageService {

  static async envoyerMessage(expediteurId, { destinataireId, contenu }) {
    const destinataire = await Utilisateur.findByPk(destinataireId);
    if (!destinataire) return { success: false, message: 'Destinataire introuvable' };

    const message = await Message.create({ expediteurId, destinataireId, contenu });
    try {
      getIO().to('user:' + destinataireId).emit('message:new', message);
    } catch (_) { /* Socket.IO pas encore initialisé — on ignore silencieusement */ }
    return { success: true, message: 'Message envoyé', data: message };
  }

  static async getConversation(userId1, userId2) {
    const messages = await Message.findAll({
      where: {
        [Op.or]: [
          { expediteurId: userId1, destinataireId: userId2 },
          { expediteurId: userId2, destinataireId: userId1 }
        ]
      },
      include: [
        { model: Utilisateur, as: 'expediteur', attributes: ['id', 'nom', 'prenom', 'photoProfil'] },
        { model: Utilisateur, as: 'destinataire', attributes: ['id', 'nom', 'prenom', 'photoProfil'] }
      ],
      order: [['createdAt', 'ASC']]
    });
    return messages;
  }

  static async getConversations(userId) {
    // Récupère les derniers messages par interlocuteur
    const messages = await Message.findAll({
      where: {
        [Op.or]: [{ expediteurId: userId }, { destinataireId: userId }]
      },
      include: [
        { model: Utilisateur, as: 'expediteur', attributes: ['id', 'nom', 'prenom', 'photoProfil'] },
        { model: Utilisateur, as: 'destinataire', attributes: ['id', 'nom', 'prenom', 'photoProfil'] }
      ],
      order: [['createdAt', 'DESC']]
    });

    // Dédupliquer par interlocuteur
    const conversationsMap = new Map();
    for (const msg of messages) {
      const interlocuteurId = msg.expediteurId === userId ? msg.destinataireId : msg.expediteurId;
      if (!conversationsMap.has(interlocuteurId)) {
        conversationsMap.set(interlocuteurId, msg);
      }
    }
    return Array.from(conversationsMap.values());
  }

  static async marquerLu(messageId, destinataireId) {
    const message = await Message.findOne({ where: { id: messageId, destinataireId } });
    if (!message) return { success: false, message: 'Message introuvable' };
    await message.update({ lu: true });
    return { success: true, message: 'Message marqué comme lu' };
  }

  static async getNbNonLus(userId) {
    const [messages, site] = await Promise.all([
      Message.count({ where: { destinataireId: userId, lu: false } }),
      MessageSite.count({ where: { vendeurId: userId, lu: false } }),
    ]);
    // `nonLus` reste le total : c'est lui qu'affiche la pastille.
    return { nonLus: messages + site, messages, site };
  }

  // ── Messages laissés sur le site de la boutique ─────────────────────

  /** Les messages reçus via la page Contact du site, du plus récent au plus ancien. */
  static async listerMessagesSite(vendeurId, { page = 1, limit = 50 } = {}) {
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const p = Math.max(Number(page) || 1, 1);
    const { rows, count } = await MessageSite.findAndCountAll({
      where: { vendeurId },
      attributes: ['id', 'nom', 'telephone', 'contenu', 'lu', 'createdAt'],
      order: [['createdAt', 'DESC']],
      limit: lim,
      offset: (p - 1) * lim,
    });
    const nonLus = await MessageSite.count({ where: { vendeurId, lu: false } });
    return { messages: rows, total: count, nonLus, page: p };
  }

  static async marquerMessageSiteLu(id, vendeurId) {
    if (!FORMAT_UUID.test(String(id))) return { success: false, message: 'Message introuvable' };
    const [nb] = await MessageSite.update({ lu: true }, { where: { id, vendeurId } });
    if (!nb) return { success: false, message: 'Message introuvable' };
    return { success: true, message: 'Message marqué comme lu' };
  }

  static async supprimerMessageSite(id, vendeurId) {
    if (!FORMAT_UUID.test(String(id))) return { success: false, message: 'Message introuvable' };
    const nb = await MessageSite.destroy({ where: { id, vendeurId } });
    if (!nb) return { success: false, message: 'Message introuvable' };
    return { success: true, message: 'Message supprimé' };
  }
}

module.exports = MessageService;
