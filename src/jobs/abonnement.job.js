const { Abonnement, Utilisateur } = require('../models');
const { Op } = require('sequelize');
const { sendAbonnementExpiration } = require('../services/resend.service');
const { sendPushToUsers } = require('../services/push.service');
const logger = require('../utils/logger');

async function expireAbonnements() {
  const maintenant = new Date();

  // 1. Expirer abonnements
  await Abonnement.update(
    { statut: 'expire' },
    {
      where: {
        dateFin: { [Op.lt]: maintenant },
        statut: 'actif'
      }
    }
  );

  // 2. Désactiver vendeurs sans abonnement actif
  const vendeurs = await Utilisateur.findAll({
    include: [
      {
        model: Abonnement,
        as: 'abonnements',
        required: false,
        where: {
          statut: 'actif',
          dateFin: { [Op.gte]: maintenant }
        }
      }
    ]
  });

  await Promise.all(
    vendeurs.map(async (v) => {
      if (!v.abonnements || v.abonnements.length === 0) {
        if (v.statut !== 'inactif') {
          await v.update({ statut: 'inactif' });
        }
      }
    })
  );

  // 3. Envoyer rappels d'expiration (7j et 3j avant)
  const now = new Date();
  for (const jours of [7, 3]) {
    const cible = new Date(now);
    cible.setDate(cible.getDate() + jours);
    const debut = new Date(cible.setHours(0, 0, 0, 0));
    const fin   = new Date(cible.setHours(23, 59, 59, 999));

    const abonnementsProches = await Abonnement.findAll({
      where: {
        statut: 'actif',
        dateFin: { [Op.between]: [debut, fin] }
      },
      include: [{ model: Utilisateur, as: 'utilisateur', attributes: ['id', 'nom', 'prenom', 'email', 'role'] }]
    });

    for (const abo of abonnementsProches) {
      const u = abo.utilisateur;
      if (!u || u.role !== 'Vendeur') continue;
      sendAbonnementExpiration({
        to: u.email,
        nom: `${u.prenom} ${u.nom}`,
        dateFin: abo.dateFin,
        joursRestants: jours
      }).catch(() => {});
      sendPushToUsers(u.id, {
        title: `⏰ Abonnement expire dans ${jours} jour${jours > 1 ? 's' : ''}`,
        body: 'Renouvelez votre abonnement pour continuer à vendre.',
        data: { type: 'rappel_abonnement', joursRestants: String(jours) }
      }).catch(() => {});
    }
  }

  logger.info('Job abonnement exécuté');
}

module.exports = expireAbonnements;