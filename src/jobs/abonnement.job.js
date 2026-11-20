const { Abonnement, Utilisateur } = require('../models');
const { Op } = require('sequelize');
const { sendAbonnementExpiration } = require('../services/resend.service');
const NotificationService = require('../services/notifications/notification.service');
const logger = require('../utils/logger');
const echecIgnore = require('../utils/echecIgnore');

async function expireAbonnements() {
  const maintenant = new Date();

  // 1. Expirer abonnements
  //
  // Lus AVANT la mise à jour, pour savoir qui prévenir : un `update` en masse
  // ne rend que le nombre de lignes touchées. Le vendeur recevait un rappel à
  // sept jours, un autre à trois, puis plus rien — il découvrait que sa
  // boutique était bloquée en essayant de vendre, sans comprendre pourquoi.
  const expires = await Abonnement.findAll({
    where: { dateFin: { [Op.lt]: maintenant }, statut: 'actif' },
    include: [{ model: Utilisateur, as: 'utilisateur', attributes: ['id', 'role'] }],
  });

  await Abonnement.update(
    { statut: 'expire' },
    {
      where: {
        dateFin: { [Op.lt]: maintenant },
        statut: 'actif'
      }
    }
  );

  for (const abo of expires) {
    const u = abo.utilisateur;
    if (!u || u.role !== 'Vendeur') continue;
    NotificationService.creerNotification({
      utilisateurId: u.id,
      titre: 'Abonnement expiré',
      message: 'Votre abonnement a pris fin. Renouvelez-le pour remettre votre boutique en vente.',
      type: 'abonnement',
      data: { abonnementId: abo.id },
    }).catch(echecIgnore('notification abonnement expiré'));
  }

  // Ce job ne touche pas au statut des comptes. L'abonnement est exigé route
  // par route par finAbonnement.middleware (403 « abonnement expiré ») ;
  // désactiver le compte bloquerait la connexion elle-même, et un vendeur
  // dont l'abonnement vient d'expirer ne pourrait plus se connecter pour le
  // renouveler.
  //
  // Un compte ne passe à 'inactif' que sur geste explicite : admin.service
  // (suspension par un administrateur) ou account.service (désactivation par
  // son propriétaire).

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
      }).catch(echecIgnore('e-mail abonnement bientôt expiré'));

      // `creerNotification` plutôt qu'un push direct : elle pose aussi la
      // ligne dans le centre de notifications, donc le compteur de non-lus
      // bouge et le vendeur retrouve le rappel en ouvrant l'application. Le
      // push seul afficherait une bannière qui ne laisse aucune trace.
      //
      // `type: 'abonnement'` et `abonnementId` ne sont pas décoratifs : c'est
      // ce que le téléphone lit pour ouvrir « Mon abonnement » quand on touche
      // la notification. Un type inconnu de l'application ferait retomber le
      // toucher sur la messagerie.
      NotificationService.creerNotification({
        utilisateurId: u.id,
        titre: `⏰ Abonnement expire dans ${jours} jour${jours > 1 ? 's' : ''}`,
        message: 'Renouvelez votre abonnement pour continuer à vendre.',
        type: 'abonnement',
        data: { abonnementId: abo.id, joursRestants: String(jours) },
      }).catch(echecIgnore('notification abonnement bientôt expiré'));
    }
  }

  logger.info('Job abonnement exécuté');
}

module.exports = expireAbonnements;