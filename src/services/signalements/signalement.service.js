const { Signalement, Produit, Boutique } = require('../../models');
const { NotFoundError } = require('../../errors/AppError');
const { paginate, metaPagination } = require('../../utils/paginate');

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

  /**
   * Les signalements d'un utilisateur, AVEC CE QU'ILS VISENT.
   *
   * La table ne garde qu'un `cibleId` et un `type` : l'application recevait
   * donc une liste sans nom, et affichait la raison saisie à la place de la
   * boutique. « dww » en gros titre, au-dessus d'une description — on ne
   * savait plus de quoi on avait parlé.
   *
   * Les cibles sont relues en DEUX requêtes, une par type, et non une par
   * signalement.
   */
  static async mesSignalements(signaleurId, { page, limit } = {}) {
    const { page: p, limit: l, offset } = paginate(page, limit);
    const { rows: lignes, count } = await Signalement.findAndCountAll({
      where: { signaleurId },
      order: [['createdAt', 'DESC']],
      limit: l,
      offset,
    });

    const idsParType = { boutique: [], produit: [] };
    for (const s of lignes) {
      if (idsParType[s.type]) idsParType[s.type].push(s.cibleId);
    }

    const [boutiques, produits] = await Promise.all([
      idsParType.boutique.length
        ? Boutique.findAll({
          where: { id: [...new Set(idsParType.boutique)] },
          attributes: ['id', 'nom', 'logo'],
        })
        : [],
      idsParType.produit.length
        ? Produit.findAll({
          where: { id: [...new Set(idsParType.produit)] },
          attributes: ['id', 'nom', 'image'],
        })
        : [],
    ]);

    const parId = new Map();
    for (const b of boutiques) {
      parId.set(b.id, { id: b.id, nom: b.nom, image: b.logo || null });
    }
    for (const p of produits) {
      parId.set(p.id, { id: p.id, nom: p.nom, image: p.image || null });
    }

    const signalements = lignes.map((s) => ({
      ...s.toJSON(),
      // `null` quand la cible a disparu depuis : une boutique fermée, un
      // produit retiré. Le signalement, lui, reste — c'est son intérêt.
      cible: parId.get(s.cibleId) || null,
    }));

    return { signalements, ...metaPagination(count, p, l) };
  }
}

module.exports = SignalementService;
