const cloudinary = require('../../config/cloudinary');
const streamifier = require('streamifier');
const logger = require('../../utils/logger');

// Ce module vivait dans middlewares/ sous le nom uploadService.js alors qu'il
// n'est pas un middleware : il ne reçoit ni `req` ni `res`, il envoie un
// buffer vers Cloudinary. Il rejoint donc les services (standard SIGN :
// « une responsabilité par fichier, un nommage qui annonce la couche »).

// ─────────────────────────────────────────────────────────────────────────────
//  Réduction des images à l'envoi.
//
//  Les photos arrivent droit d'un téléphone : 3 à 5 Mo, 4000 px de large.
//  Elles étaient stockées telles quelles puis servies telles quelles aux
//  listes de produits de l'application, ce qui pèse lourd sur un forfait
//  mobile et ralentit chaque écran de catalogue.
//
//  Transformation « entrante » : Cloudinary redimensionne UNE fois à la
//  réception, et l'original surdimensionné n'est jamais conservé.
//    - `crop: 'limit'` ne fait que réduire, jamais agrandir ni recadrer ;
//    - 1600 px suffit pour un plein écran de téléphone en haute densité ;
//    - `quality: 'auto:good'` laisse Cloudinary choisir la compression.
//
//  Réservé aux images : une pièce justificative en PDF ne doit pas être
//  rastérisée. On reconnaît le type aux premiers octets, déjà contrôlés par
//  `upload.verifyMagicBytes` en amont.
// ─────────────────────────────────────────────────────────────────────────────
const TAILLE_MAX_IMAGE = Number(process.env.UPLOAD_IMAGE_MAX_PX) || 1600;

function estImageMatricielle(buffer) {
  if (!buffer || buffer.length < 4) return false;
  const png = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
  const jpeg = buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
  return png || jpeg;
}

const uploadImage = (fileBuffer) => {
  const options = { folder: 'saambiz' };
  if (estImageMatricielle(fileBuffer)) {
    options.transformation = [{
      width: TAILLE_MAX_IMAGE,
      height: TAILLE_MAX_IMAGE,
      crop: 'limit',
      quality: 'auto:good',
    }];
  }

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (result) resolve(result.secure_url);
      else reject(error);
    });

    streamifier.createReadStream(fileBuffer).pipe(stream);
  });
};

// Supprime une image Cloudinary à partir de son URL secure_url (best-effort, ne throw jamais)
const deleteImage = async (imageUrl) => {
  try {
    if (!imageUrl) return;
    // Extrait le public_id à partir de l'URL Cloudinary, ex :
    // https://res.cloudinary.com/xxx/image/upload/v123456/saambiz/abc123.jpg → saambiz/abc123
    // (le public_id est extrait de l'URL : les images déposées sous l'ancien
    //  dossier « jendal » restent supprimables.)
    const match = imageUrl.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+$/);
    if (!match) return;
    const publicId = match[1];
    await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    logger.error('uploadService:deleteImage', { message: err.message });
  }
};

module.exports = { uploadImage, deleteImage, estImageMatricielle };
