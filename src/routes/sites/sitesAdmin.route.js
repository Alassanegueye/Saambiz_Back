const express = require('express');
const SitesController = require('../../controllers/sites/sites.controller');
const auth = require('../../middlewares/auth.middleware');
const isAdmin = require('../../middlewares/isAdmin.middleware');
const checkActiveUser = require('../../middlewares/checkActiveUser.middleware');
const requirePermission = require('../../middlewares/requirePermission.middleware');

/**
 * Les sites vitrines, côté administration :
 *
 *  - kodafrik.com (dashboard Kodafrik, page « Site vitrine ») : sa
 *    fréquentation, ses messages, et les e-mails du back-office. Ouvert à qui
 *    voit la vue d'ensemble ou gère les administrateurs ;
 *  - saambiz.com (administration SaamBiz, page « Site vitrine ») : les
 *    visites des boutiques et l'activité des vendeurs. Ouvert à qui voit les
 *    vendeurs ou la vue d'ensemble.
 *
 * Même chaîne que toute l'administration : auth → checkActiveUser → isAdmin
 * → requirePermission.
 */
const router = express.Router();
router.use(auth);
router.use(checkActiveUser);
router.use(isAdmin);

const voirKodafrik = requirePermission(['DASHBOARD', 'ADMINS'], 'view');
const gererKodafrik = requirePermission(['DASHBOARD', 'ADMINS'], 'update');
const voirSaambiz = requirePermission(['VENDEURS', 'DASHBOARD'], 'view');

// Les routes propres à SaamBiz d'abord : `/saambiz/vendeurs` ne doit pas
// passer pour un site nommé « saambiz » suivi d'une ressource inconnue.
router.get('/saambiz/boutiques', voirSaambiz, SitesController.boutiques);
router.get('/saambiz/vendeurs', voirSaambiz, SitesController.vendeurs);
router.get('/saambiz/vendeurs/:id/activites', voirSaambiz, SitesController.activitesVendeur);
router.get('/saambiz/statistiques', voirSaambiz, SitesController.statistiques);
router.get('/saambiz/visites', voirSaambiz, SitesController.visites);

router.get('/:site/statistiques', voirKodafrik, SitesController.statistiques);
router.get('/:site/visites', voirKodafrik, SitesController.visites);
router.get('/:site/messages', voirKodafrik, SitesController.messages);
router.patch('/:site/messages/:id', gererKodafrik, SitesController.changerStatutMessage);
router.get('/:site/mails', voirKodafrik, SitesController.mails);
router.post('/:site/mails', gererKodafrik, SitesController.envoyerMail);

module.exports = router;
