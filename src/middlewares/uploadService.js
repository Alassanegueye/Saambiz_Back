const cloudinary = require('../config/cloudinary');
const streamifier = require('streamifier');
const logger = require('../utils/logger');

const uploadImage = (fileBuffer) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "saambiz"
      },
      (error, result) => {
        if (result) resolve(result.secure_url);
        else reject(error);
      }
    );

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

module.exports = { uploadImage, deleteImage };