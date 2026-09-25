// Job : expiration des promotions.
// - Désactive les promotions dont la date de fin est passée.
// - Nettoie le prix barré (prix_promo) des produits qui n'ont plus aucune promo active.
const { Promotion, Produit } = require('../models');
const { Op } = require('sequelize');
const logger = require('../utils/logger');

async function expirerPromotions() {
  const now = new Date();

  // 1) Récupère les promotions expirées encore marquées actives
  const expirees = await Promotion.findAll({
    where: { active: true, dateFin: { [Op.lt]: now } },
    attributes: ['id', 'produitId'],
  });

  if (!expirees.length) return 0;

  // 2) Les désactive
  await Promotion.update(
    { active: false },
    { where: { id: expirees.map(p => p.id) } }
  );

  // 3) Pour chaque produit concerné, retire le prix barré s'il n'a plus de promo active valide
  const produitIds = [...new Set(expirees.map(p => p.produitId).filter(Boolean))];
  for (const produitId of produitIds) {
    const encoreEnPromo = await Promotion.count({
      where: { produitId, active: true, dateFin: { [Op.gte]: now } },
    });
    if (!encoreEnPromo) {
      await Produit.update({ prix_promo: null }, { where: { id: produitId } });
    }
  }

  logger.info(`job.promotion : ${expirees.length} promotion(s) expirée(s), ${produitIds.length} produit(s) nettoyé(s)`);
  return expirees.length;
}

module.exports = expirerPromotions;
