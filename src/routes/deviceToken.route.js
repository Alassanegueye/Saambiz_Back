const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const { saveDeviceToken, removeDeviceToken } = require('../services/push.service');

router.use(authMiddleware);

// Enregistrer ou mettre à jour un device token FCM
router.post('/register', async (req, res) => {
  const { token, platform } = req.body;
  if (!token) return res.status(400).json({ success: false, message: 'Token requis' });
  try {
    await saveDeviceToken(req.user.id, token, platform || 'android');
    return res.status(200).json({ success: true, message: 'Token enregistré' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Erreur serveur interne.' });
  }
});

// Supprimer le token au logout
router.delete('/unregister', async (req, res) => {
  const { token } = req.body;
  try {
    await removeDeviceToken(req.user.id, token || null);
    return res.status(200).json({ success: true, message: 'Token supprimé' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Erreur serveur interne.' });
  }
});

module.exports = router;
