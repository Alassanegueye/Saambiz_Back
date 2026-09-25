const express = require('express');
const router = express.Router();
const notificationController = require('../../controllers/notifications/notification.controller');
const auth = require('../../middlewares/auth.middleware');
const checkActiveUser = require('../../middlewares/checkActiveUser.middleware');

router.use(auth);
router.use(checkActiveUser);

router.get('/', notificationController.mesNotifications);
router.get('/non-lues', notificationController.getNbNonLues);
router.put('/toutes-lues', notificationController.marquerToutesLues);
router.put('/:id/lire', notificationController.marquerLue);

module.exports = router;
