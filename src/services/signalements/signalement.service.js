const { Signalement, Produit, Boutique } = require('../../models');
const { NotFoundError } = require('../../errors/AppError');

class SignalementService {

  static async signalerContenu(signaleurId, { type, cibleId, raison, description }) {
    // Vérifier que la cible existe
    if (type === 'produit') {
      const produit = await Produit.findByPk(cibleId);
      if (!produit) throw new NotFoundError('Produit introuvable');
    } else if (type === 'boutique') {
      const boutique = await Boutique.findByPk(cibleId);
      if (!boutique) throw new NotFoundError('Boutique introuvable');
    }

    const signalement = await Signalement.create({
      type,
      cibleId,
      raison,
      description,
      signaleurId,
    });

    return { signalement };
  }

  static async mesSignalements(signaleurId) {
    const signalements = await Signalement.findAll({
      where: { signaleurId },
      order: [['createdAt', 'DESC']],
    });
    return { signalements };
  }
}

module.exports = SignalementService;
