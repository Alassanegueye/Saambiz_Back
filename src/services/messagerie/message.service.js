const { Message, Utilisateur } = require('../../models');
const { Op, fn, col, literal } = require('sequelize');
const sequelize = require('../../config/db');
const { getIO } = require('../socket.service');

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
    const count = await Message.count({ where: { destinataireId: userId, lu: false } });
    return { nonLus: count };
  }
}

module.exports = MessageService;
