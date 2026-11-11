const multer = require('multer');
const { uploadConfig } = require('../config/security');
const { BadRequestError } = require('../errors/AppError');

// ──────────────────────────────────────────────────────────────────────────────
// H-02 : vérification des magic bytes réels (pas du Content-Type client)
// ──────────────────────────────────────────────────────────────────────────────
function detectMimeFromBuffer(buffer) {
  if (!buffer || buffer.length < 4) return null;

  // PNG : 89 50 4E 47 0D 0A 1A 0A
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return 'image/png';
  }
  // JPEG : FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'image/jpeg';
  }
  // PDF : %PDF (25 50 44 46)
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return 'application/pdf';
  }
  return null;
}

// Filtre Multer — premier contrôle sur le Content-Type déclaré
// « application/octet-stream » est accepté ici : c'est ce qu'envoient par
// défaut les applications mobiles (Dio). Le vrai type est de toute façon
// contrôlé sur le contenu par `verifyMagicBytes`. Un refus est une erreur
// 400 lisible, et non plus une erreur 500 « Erreur serveur interne ».
const fileFilter = (req, file, cb) => {
  if (uploadConfig.allowedMimeTypes.includes(file.mimetype) || file.mimetype === 'application/octet-stream') {
    cb(null, true);
  } else {
    cb(new BadRequestError('Format de fichier non accepté : envoyez une photo JPEG ou PNG.'), false);
  }
};

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: uploadConfig.maxFileSize },
  fileFilter,
});

// ──────────────────────────────────────────────────────────────────────────────
// Middleware de vérification des magic bytes — à chaîner après upload.single/fields
// Vérifie chaque fichier uploadé contre son contenu réel
// ──────────────────────────────────────────────────────────────────────────────
upload.verifyMagicBytes = (req, res, next) => {
  const files = req.files
    ? (Array.isArray(req.files) ? req.files : Object.values(req.files).flat())
    : (req.file ? [req.file] : []);

  for (const file of files) {
    const realMime = detectMimeFromBuffer(file.buffer);
    if (!realMime || !uploadConfig.allowedMimeTypes.includes(realMime)) {
      return res.status(400).json({
        success: false,
        message: 'Format de photo non accepté : envoyez une image JPEG ou PNG.',
      });
    }
    // Corriger le mimetype avec la valeur réelle
    file.mimetype = realMime;
  }
  next();
};

module.exports = upload;
