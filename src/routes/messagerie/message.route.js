const express = require('express');
const router = express.Router();
const messageController = require('../../controllers/messagerie/message.controller');
const auth = require('../../middlewares/auth.middleware');
const checkActiveUser = require('../../middlewares/checkActiveUser.middleware');
const validate = require('../../middlewares/validate.middleware');
const { envoyerMessageSchema } = require('../../validations/message.validation');

router.use(auth);
router.use(checkActiveUser);

router.post('/', validate(envoyerMessageSchema), messageController.envoyerMessage);
router.get('/conversations', messageController.getConversations);
router.get('/non-lus', messageController.getNbNonLus);
// Messages laissés sur la page Contact du site de la boutique (avant `/:userId`).
router.get('/site', messageController.listerMessagesSite);
router.put('/site/:id/lire', messageController.marquerMessageSiteLu);
router.delete('/site/:id', messageController.supprimerMessageSite);
router.get('/:userId', messageController.getConversation);
router.put('/:messageId/lire', messageController.marquerLu);

module.exports = router;
