const { Abonnement, Utilisateur } = require('../models');
const { Op } = require('sequelize');
const { sendAbonnementExpiration } = require('../services/resend.service');
const NotificationService = require('../services/notifications/notification.service');
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

  // Ce job ne touche plus au statut des comptes.
  //
  // Il y avait ici une etape « Desactiver vendeurs sans abonnement actif »
  // qui chargeait Utilisateur.findAll() SANS filtre de role — la variable
  // s'appelait `vendeurs`, mais la requete ramenait tout le monde — puis
  // passait a `statut: 'inactif'` quiconque n'avait pas d'abonnement en
  // cours. Les Admin et les Acheteur n'en ont jamais : chaque nuit a 00h00,
  // tous leurs comptes etaient donc desactives, et auth.service refusait
  // ensuite la connexion avec « Votre compte est inactif ».
  //
  // Elle etait aussi redondante et nuisible, meme corrigee du filtre de
  // role : l'abonnement est deja exige route par route par
  // finAbonnement.middleware (403 « abonnement expire »), alors que
  // desactiver le compte bloque la connexion elle-meme — un vendeur dont
  // l'abonnement venait d'expirer ne pouvait plus se connecter pour le
  // renouveler.
  //
  // Un compte ne passe donc plus a 'inactif' que sur geste explicite :
  // admin.service (suspension par un administrateur) ou account.service
  // (desactivation par son proprietaire).

  // 2. Envoyer rappels d'expiration (7j et 3j avant)
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

      // LES DEUX CANAUX, VOLONTAIREMENT. Un abonnement qui expire coûte sa
      // boutique au vendeur : c'est le seul rappel qu'on ne veut pas voir
      // manqué parce qu'un téléphone était éteint ce jour-là, ou parce que
      // les notifications avaient été refusées à l'installation.
      sendAbonnementExpiration({
        to: u.email,
        nom: `${u.prenom} ${u.nom}`,
        dateFin: abo.dateFin,
        joursRestants: jours
      }).catch(() => {});

      // `creerNotification` plutôt qu'un push direct : elle pose aussi la
      // ligne dans le centre de notifications, donc le compteur de non-lus
      // bouge et le vendeur retrouve le rappel en ouvrant l'application. Le
      // push seul affichait une bannière qui ne laissait aucune trace.
      //
      // `type: 'abonnement'` et `abonnementId` ne sont pas décoratifs : c'est
      // ce que le téléphone lit pour ouvrir « Mon abonnement » quand on touche
      // la notification. Avec l'ancien `type: 'rappel_abonnement'`, inconnu de
      // l'application, le toucher retombait sur la messagerie.
      NotificationService.creerNotification({
        utilisateurId: u.id,
        titre: `⏰ Abonnement expire dans ${jours} jour${jours > 1 ? 's' : ''}`,
        message: 'Renouvelez votre abonnement pour continuer à vendre.',
        type: 'abonnement',
        data: { abonnementId: abo.id, joursRestants: String(jours) },
      }).catch(() => {});
    }
  }

  logger.info('Job abonnement exécuté');
}

module.exports = expireAbonnements;