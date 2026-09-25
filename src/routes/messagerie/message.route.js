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
router.get('/:userId', messageController.getConversation);
router.put('/:messageId/lire', messageController.marquerLu);

module.exports = router;
