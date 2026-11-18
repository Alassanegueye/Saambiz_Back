const crypto = require('crypto');
const streamifier = require('streamifier');
const logger = require('../../utils/logger');
const { ServiceUnavailableError } = require('../../errors/AppError');
const r2 = require('./r2.service');

// ─────────────────────────────────────────────────────────────────────────────
//  Stockage des fichiers : Cloudflare R2, comme Widjila.
//
//  - Photos (produits, logos, bannières, promotions, profils, site) : bucket
//    PUBLIC R2. La base garde l'URL publique complète, comme elle gardait
//    celle de Cloudinary : l'application, le site et le back-office n'ont rien
//    à changer.
//  - Pièces d'identité (certification) : bucket PRIVÉ. La base garde
//    « prive:<clé> » ; l'administrateur reçoit un lien signé de dix minutes.
//
//  Cloudinary ne sert plus qu'en REPLI, tant que les variables R2_* ne sont
//  pas renseignées (un déploiement avant le .env ne casse donc rien), et pour
//  supprimer les images déposées avant le passage à R2.
// ─────────────────────────────────────────────────────────────────────────────

// Chargé à la demande : sans R2, c'est le stockage d'avant.
let instanceCloudinary = null;
const cloudinary = () => {
  if (!instanceCloudinary) instanceCloudinary = require('../../config/cloudinary');
  return instanceCloudinary;
};
const cloudinaryConfigure = () => Boolean(
  process.env.CLOUDINARY_CLOUD_NAME
  && process.env.CLOUDINARY_API_KEY
  && process.env.CLOUDINARY_API_SECRET
);

// ─────────────────────────────────────────────────────────────────────────────
//  Réduction des images à l'envoi.
//
//  Les photos arrivent droit d'un téléphone : 3 à 5 Mo, 4000 px de large.
//  Cloudinary les réduisait à la réception ; avec R2, c'est le serveur qui
//  le fait (sharp, comme Widjila), UNE fois :
//    - redressée selon l'orientation EXIF du téléphone ;
//    - 1600 px au plus sur le côté le plus long, jamais agrandie ;
//    - recompressée (JPEG qualité 82) ; un PNG garde sa transparence ;
//    - sans métadonnées : la position GPS de la prise de vue ne part pas
//      avec la photo d'un produit.
//  Un PDF passe tel quel. Le type a déjà été contrôlé sur les premiers
//  octets par `upload.verifyMagicBytes`.
// ─────────────────────────────────────────────────────────────────────────────
const TAILLE_MAX_IMAGE = Number(process.env.UPLOAD_IMAGE_MAX_PX) || 1600;

function estImageMatricielle(buffer) {
  if (!buffer || buffer.length < 4) return false;
  const png = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
  const jpeg = buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
  return png || jpeg;
}

const estPng = (buffer) => buffer?.[0] === 0x89 && buffer?.[1] === 0x50;
const estPdf = (buffer) => Boolean(buffer && buffer.length >= 4
  && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46);

/**
 * Contenu prêt pour R2, avec son extension et son type.
 * Une image illisible par sharp part telle quelle plutôt que d'échouer.
 * @returns {Promise<{ buffer: Buffer, extension: string, type: string }>}
 */
async function preparer(buffer) {
  if (estImageMatricielle(buffer)) {
    try {
      const sharp = require('sharp');
      const meta = await sharp(buffer).metadata();
      // PNG transparent (logo) : reste PNG. Toute autre photo : JPEG.
      const garderPng = estPng(buffer) && Boolean(meta.hasAlpha);
      let image = sharp(buffer, { failOn: 'error' })
        .rotate()
        .resize({
          width: TAILLE_MAX_IMAGE,
          height: TAILLE_MAX_IMAGE,
          fit: 'inside',
          withoutEnlargement: true,
        });
      image = garderPng
        ? image.png({ compressionLevel: 9 })
        : image.jpeg({ quality: 82, mozjpeg: true });
      return {
        buffer: await image.toBuffer(),
        extension: garderPng ? 'png' : 'jpg',
        type: garderPng ? 'image/png' : 'image/jpeg',
      };
    } catch (err) {
      logger.warn('[stockage] image non optimisée, envoyée telle quelle', { message: err.message });
      return estPng(buffer)
        ? { buffer, extension: 'png', type: 'image/png' }
        : { buffer, extension: 'jpg', type: 'image/jpeg' };
    }
  }
  if (estPdf(buffer)) return { buffer, extension: 'pdf', type: 'application/pdf' };
  return { buffer, extension: 'bin', type: 'application/octet-stream' };
}

/**
 * Clé d'un nouvel objet : « dossier/aaaa/mm/<horodatage>-<24 hex>.<ext> ».
 * Le nom est aléatoire : rien (nom du vendeur, type de pièce) ne fuit par
 * l'adresse, et deux envois ne s'écrasent jamais.
 */
function nouvelleCle(dossier, extension, maintenant = new Date()) {
  const propre = String(dossier || 'images')
    .toLowerCase()
    .replace(/[^a-z0-9/_-]/g, '')
    .replace(/^\/+|\/+$/g, '') || 'images';
  const annee = maintenant.getUTCFullYear();
  const mois = String(maintenant.getUTCMonth() + 1).padStart(2, '0');
  const alea = crypto.randomBytes(12).toString('hex');
  return `${propre}/${annee}/${mois}/${maintenant.getTime()}-${alea}.${extension}`;
}

// ── Repli Cloudinary (avant la configuration de R2) ──────────────────────────

function envoyerCloudinary(fileBuffer) {
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
    const stream = cloudinary().uploader.upload_stream(options, (error, result) => {
      if (result) return resolve(result.secure_url);
      logger.error('[Cloudinary] envoi impossible', { message: error?.message, http_code: error?.http_code });
      return reject(new ServiceUnavailableError('Envoi de la photo impossible pour le moment. Réessayez dans un instant.'));
    });
    streamifier.createReadStream(fileBuffer).pipe(stream);
  });
}

// ── API du module ─────────────────────────────────────────────────────────────

/**
 * Enregistre une photo visible des clients et renvoie son URL publique.
 * @param {Buffer} fileBuffer
 * @param {string} [dossier] rangement dans le bucket : produits, boutiques,
 *   profils, promotions, vitrine…
 */
const uploadImage = async (fileBuffer, dossier = 'images') => {
  if (!r2.publicConfigure()) return envoyerCloudinary(fileBuffer);

  const { buffer, extension, type } = await preparer(fileBuffer);
  const cle = nouvelleCle(dossier, extension);
  try {
    await r2.envoyer(buffer, cle, { type });
  } catch (err) {
    // Panne ou configuration R2 : message clair (503), la cause au journal.
    logger.error('[R2] envoi impossible', { message: err.message, cle });
    throw new ServiceUnavailableError('Envoi de la photo impossible pour le moment. Réessayez dans un instant.');
  }
  return r2.adressePublique(cle);
};

/**
 * Enregistre un document confidentiel (pièce d'identité) dans le bucket
 * privé et renvoie « prive:<clé> », à stocker tel quel en base.
 *
 * Sans bucket privé configuré, le document suit le chemin des photos, comme
 * avant le passage à R2 : rien ne casse, mais il faut renseigner
 * R2_PRIVATE_BUCKET_NAME pour que les pièces quittent l'espace public.
 */
const uploadDocumentPrive = async (fileBuffer, dossier = 'documents') => {
  if (!r2.priveConfigure()) {
    logger.warn('[stockage] R2_PRIVATE_BUCKET_NAME absent : document rangé avec les photos');
    return uploadImage(fileBuffer, dossier);
  }
  const { buffer, extension, type } = await preparer(fileBuffer);
  const cle = nouvelleCle(dossier, extension);
  try {
    await r2.envoyer(buffer, cle, { prive: true, type });
  } catch (err) {
    logger.error('[R2] envoi privé impossible', { message: err.message, cle });
    throw new ServiceUnavailableError("Envoi du document impossible pour le moment. Réessayez dans un instant.");
  }
  return `prive:${cle}`;
};

/**
 * Adresse lisible d'une valeur stockée : un document privé devient un lien
 * signé (dix minutes par défaut) ; une URL publique reste telle quelle.
 * Null si le lien ne peut pas être produit.
 */
async function urlLecture(valeur, secondes = 600) {
  if (!valeur) return valeur ?? null;
  if (!String(valeur).startsWith('prive:')) return valeur;
  if (!r2.priveConfigure()) return null;
  try {
    return await r2.lienSigne(valeur, secondes);
  } catch (err) {
    logger.warn('[stockage] lien signé impossible', { message: err.message });
    return null;
  }
}

/**
 * Supprime un fichier à partir de la valeur stockée en base : document
 * privé, URL publique R2 ou ancienne URL Cloudinary. Best-effort : ne lève
 * jamais.
 */
const deleteImage = async (imageUrl) => {
  try {
    if (!imageUrl) return;
    const valeur = String(imageUrl);

    if (valeur.startsWith('prive:')) {
      if (r2.priveConfigure()) await r2.supprimer(valeur, { prive: true });
      return;
    }

    const base = r2.urlPublique();
    if (base && valeur.startsWith(`${base}/`)) {
      if (r2.publicConfigure()) await r2.supprimer(valeur);
      return;
    }

    // Images déposées avant R2 (y compris l'ancien dossier « jendal ») :
    // https://res.cloudinary.com/xxx/image/upload/v123456/saambiz/abc123.jpg
    // → public_id « saambiz/abc123 ».
    if (!valeur.includes('res.cloudinary.com') || !cloudinaryConfigure()) return;
    const match = valeur.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+$/);
    if (!match) return;
    await cloudinary().uploader.destroy(match[1]);
  } catch (err) {
    logger.error('uploadService:deleteImage', { message: err.message });
  }
};

/** État du stockage pour /health : configuration seulement, sans réseau. */
function etatStockage() {
  let fournisseur = 'aucun';
  if (r2.publicConfigure()) fournisseur = 'cloudflare-r2';
  else if (cloudinaryConfigure()) fournisseur = 'cloudinary';
  return { fournisseur, documentsPrives: r2.priveConfigure() };
}

module.exports = {
  uploadImage,
  uploadDocumentPrive,
  urlLecture,
  deleteImage,
  estImageMatricielle,
  etatStockage,
  // exposés pour les tests
  preparer,
  nouvelleCle,
};
