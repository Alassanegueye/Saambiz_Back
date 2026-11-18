/**
 * Stockage des fichiers sur Cloudflare R2, comme Widjila.
 *
 * Ce qui compte :
 *  - sans les variables R2_*, rien ne change : l'envoi reste sur Cloudinary ;
 *  - une photo part dans le bucket PUBLIC, rangée par dossier, sous un nom
 *    aléatoire, et la base reçoit son URL publique (les clients n'ont rien à
 *    changer) ; elle est réduite à 1600 px et perd ses métadonnées (GPS) ;
 *  - une pièce d'identité part dans le bucket PRIVÉ et ne s'ouvre que par un
 *    lien signé de dix minutes ;
 *  - la suppression vise le bon endroit : R2 public, R2 privé, Cloudinary ;
 *  - une panne R2 donne un 503 lisible, pas une erreur interne.
 */
jest.mock('@aws-sdk/client-s3', () => {
  class Commande {
    constructor(input) { this.input = input; }
  }
  class PutObjectCommand extends Commande {}
  class DeleteObjectCommand extends Commande {}
  class GetObjectCommand extends Commande {}
  class HeadBucketCommand extends Commande {}
  const send = jest.fn(async () => ({}));
  class S3Client {
    constructor(config) { this.config = config; this.send = send; }
  }
  return { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, mockSend: send };
});
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(async (client, commande, { expiresIn }) =>
    `https://signe.test/${commande.input.Bucket}/${commande.input.Key}?X-Amz-Expires=${expiresIn}`),
}));
jest.mock('../../src/config/cloudinary', () => ({
  uploader: {
    upload_stream: jest.fn((options, rappel) => {
      const { PassThrough } = require('stream');
      const flux = new PassThrough();
      flux.on('finish', () => rappel(null, {
        secure_url: 'https://res.cloudinary.com/demo/image/upload/v1/saambiz/abc.jpg',
      }));
      flux.resume();
      return flux;
    }),
    destroy: jest.fn(async () => ({ result: 'ok' })),
  },
}));

const sharp = require('sharp');
const { mockSend: send, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const cloudinary = require('../../src/config/cloudinary');
const stockage = require('../../src/services/stockage/upload.service');
const r2 = require('../../src/services/stockage/r2.service');

const R2 = {
  R2_ACCOUNT_ID: 'compte',
  R2_ACCESS_KEY_ID: 'cle',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET_NAME: 'saambiz-medias',
  R2_PUBLIC_URL: 'https://medias.test/', // la barre finale est tolérée
  R2_PRIVATE_BUCKET_NAME: 'saambiz-prive',
};
const CLOUDINARY = {
  CLOUDINARY_CLOUD_NAME: 'demo',
  CLOUDINARY_API_KEY: 'k',
  CLOUDINARY_API_SECRET: 's',
};
const sauvegarde = { ...process.env };

function environnement(vars) {
  for (const cle of [...Object.keys(R2), ...Object.keys(CLOUDINARY)]) delete process.env[cle];
  Object.assign(process.env, vars);
}

const photoJpeg = (largeur, hauteur) => sharp({
  create: { width: largeur, height: hauteur, channels: 3, background: '#c0392b' },
}).jpeg().withExif({ IFD0: { Copyright: 'Photo de test SaamBiz' } }).toBuffer();
const pngTransparent = () => sharp({
  create: { width: 400, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
}).png().toBuffer();
const pngOpaque = () => sharp({
  create: { width: 400, height: 300, channels: 3, background: '#0099ff' },
}).png().toBuffer();

const CLE = /^https:\/\/medias\.test\/produits\/\d{4}\/\d{2}\/\d{13}-[0-9a-f]{24}\.jpg$/;

beforeEach(() => {
  send.mockReset().mockResolvedValue({});
  getSignedUrl.mockClear();
  cloudinary.uploader.upload_stream.mockClear();
  cloudinary.uploader.destroy.mockClear();
});
afterAll(() => {
  process.env = sauvegarde;
});

describe('Sans les variables R2 : rien ne change', () => {
  test('la photo part encore sur Cloudinary', async () => {
    environnement(CLOUDINARY);
    const url = await stockage.uploadImage(await photoJpeg(800, 600), 'produits');

    expect(url).toMatch(/^https:\/\/res\.cloudinary\.com\//);
    expect(cloudinary.uploader.upload_stream).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
    expect(stockage.etatStockage()).toEqual({ fournisseur: 'cloudinary', documentsPrives: false });
  });
});

describe('Avec R2 : les photos', () => {
  beforeEach(() => environnement({ ...R2, ...CLOUDINARY }));

  test('bucket public, rangée par dossier, nom aléatoire, URL publique', async () => {
    const url = await stockage.uploadImage(await photoJpeg(800, 600), 'produits');

    expect(url).toMatch(CLE);
    expect(cloudinary.uploader.upload_stream).not.toHaveBeenCalled();
    const [commande] = send.mock.calls[0];
    expect(commande).toBeInstanceOf(PutObjectCommand);
    expect(commande.input).toMatchObject({
      Bucket: 'saambiz-medias',
      ContentType: 'image/jpeg',
      CacheControl: 'public, max-age=31536000, immutable',
    });
    expect(url).toBe(`https://medias.test/${commande.input.Key}`);
    expect(stockage.etatStockage()).toEqual({ fournisseur: 'cloudflare-r2', documentsPrives: true });
  });

  test('réduite à 1600 px, sans métadonnées (dont la position GPS)', async () => {
    const { buffer } = await stockage.preparer(await photoJpeg(4000, 3000));
    const meta = await sharp(buffer).metadata();

    expect(Math.max(meta.width, meta.height)).toBe(1600);
    expect(meta.exif).toBeUndefined();
  });

  test('une petite photo n’est pas agrandie', async () => {
    const { buffer } = await stockage.preparer(await photoJpeg(600, 400));
    expect((await sharp(buffer).metadata()).width).toBe(600);
  });

  test('un logo transparent reste PNG, une photo PNG devient JPEG', async () => {
    expect(await stockage.preparer(await pngTransparent())).toMatchObject({ extension: 'png', type: 'image/png' });
    expect(await stockage.preparer(await pngOpaque())).toMatchObject({ extension: 'jpg', type: 'image/jpeg' });
  });

  test('une panne R2 donne un 503 lisible', async () => {
    send.mockRejectedValueOnce(new Error('connexion refusée'));
    const erreur = await stockage.uploadImage(await photoJpeg(300, 200), 'produits').catch((e) => e);
    expect(erreur.status).toBe(503);
    expect(erreur.message).toContain('Envoi de la photo impossible');
  });
});

describe('Avec R2 : les pièces d’identité', () => {
  test('bucket privé, « prive:<clé> » en base, lien signé de dix minutes', async () => {
    environnement({ ...R2 });
    const valeur = await stockage.uploadDocumentPrive(await photoJpeg(1200, 800), 'certifications');

    expect(valeur).toMatch(/^prive:certifications\/\d{4}\/\d{2}\/\d{13}-[0-9a-f]{24}\.jpg$/);
    const [commande] = send.mock.calls[0];
    expect(commande.input.Bucket).toBe('saambiz-prive');
    expect(commande.input.CacheControl).toBeUndefined();

    const lien = await stockage.urlLecture(valeur);
    expect(lien).toBe(`https://signe.test/saambiz-prive/${valeur.slice('prive:'.length)}?X-Amz-Expires=600`);
  });

  test('une ancienne URL publique passe telle quelle', async () => {
    environnement({ ...R2 });
    const ancienne = 'https://res.cloudinary.com/demo/image/upload/v1/saambiz/piece.jpg';
    expect(await stockage.urlLecture(ancienne)).toBe(ancienne);
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  test('sans bucket privé, la pièce suit les photos, comme avant', async () => {
    const { R2_PRIVATE_BUCKET_NAME, ...sansPrive } = R2;
    environnement(sansPrive);
    const valeur = await stockage.uploadDocumentPrive(await photoJpeg(600, 400), 'certifications');

    expect(valeur).toMatch(/^https:\/\/medias\.test\/certifications\//);
    expect(send.mock.calls[0][0].input.Bucket).toBe('saambiz-medias');
  });
});

describe('La suppression vise le bon endroit', () => {
  beforeEach(() => environnement({ ...R2, ...CLOUDINARY }));

  test('URL publique R2 → bucket public', async () => {
    await stockage.deleteImage('https://medias.test/produits/2026/11/1763412345678-abcdefabcdefabcdefabcdef.jpg');
    const [commande] = send.mock.calls[0];
    expect(commande).toBeInstanceOf(DeleteObjectCommand);
    expect(commande.input).toEqual({
      Bucket: 'saambiz-medias',
      Key: 'produits/2026/11/1763412345678-abcdefabcdefabcdefabcdef.jpg',
    });
  });

  test('pièce privée → bucket privé', async () => {
    await stockage.deleteImage('prive:certifications/2026/11/1763412345678-abcdefabcdefabcdefabcdef.jpg');
    expect(send.mock.calls[0][0].input.Bucket).toBe('saambiz-prive');
  });

  test('ancienne image Cloudinary → Cloudinary', async () => {
    await stockage.deleteImage('https://res.cloudinary.com/demo/image/upload/v12/saambiz/abc123.jpg');
    expect(cloudinary.uploader.destroy).toHaveBeenCalledWith('saambiz/abc123');
    expect(send).not.toHaveBeenCalled();
  });

  test('une adresse étrangère n’est jamais touchée', async () => {
    await stockage.deleteImage('https://autre-site.test/produits/x.jpg');
    expect(send).not.toHaveBeenCalled();
    expect(cloudinary.uploader.destroy).not.toHaveBeenCalled();
  });
});

describe('Les clés', () => {
  test('un dossier est nettoyé, une remontée est refusée', () => {
    const cle = stockage.nouvelleCle('../Produits !', 'jpg', new Date(Date.UTC(2026, 10, 18)));
    expect(cle).toMatch(/^produits\/2026\/11\/\d{13}-[0-9a-f]{24}\.jpg$/);
    environnement({ ...R2 });
    expect(r2.versCle('prive:../secret.jpg')).toBeNull();
    expect(r2.versCle('https://ailleurs.test/produits/x.jpg')).toBeNull();
  });
});
