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

  // Deux requêtes au total, quel que soit le nombre de produits.
  //
  // La boucle précédente en lançait deux PAR produit : un `count` pour savoir
  // s'il restait une promotion active, puis un `update`. Sur une fin de
  // campagne qui expire cent promotions, cela faisait deux cents allers-
  // retours vers la base, un par un, pendant que la tâche tenait sa
  // connexion.
  if (produitIds.length) {
    // 3a) Ceux qui gardent une promotion active : une seule requête groupée.
    const encoreEnPromo = await Promotion.findAll({
      where: { produitId: produitIds, active: true, dateFin: { [Op.gte]: now } },
      attributes: ['produitId'],
      group: ['produitId'],
      raw: true,
    });
    const aGarder = new Set(encoreEnPromo.map(p => p.produitId));

    // 3b) Les autres perdent leur prix barré, en une seule écriture.
    const aNettoyer = produitIds.filter(id => !aGarder.has(id));
    if (aNettoyer.length) {
      await Produit.update({ prix_promo: null }, { where: { id: aNettoyer } });
    }
  }

  logger.info(`job.promotion : ${expirees.length} promotion(s) expirée(s), ${produitIds.length} produit(s) nettoyé(s)`);
  return expirees.length;
}

module.exports = expirerPromotions;
