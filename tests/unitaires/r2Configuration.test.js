/**
 * Ce qui manquait quand l'envoi des photos est tombé en production.
 *
 * Le journal disait :
 *
 *   [R2] envoi impossible — write EPROTO … ssl3_read_bytes:
 *   ssl/tls alert handshake failure … SSL alert number 40
 *
 * et la clé du fichier. Rien sur l'hôte contacté, rien sur le bucket visé,
 * rien sur la variable à corriger. Or l'identifiant de compte ENTRE DANS LE
 * NOM D'HÔTE : une espace ou un retour à la ligne collé avec lui depuis le
 * tableau de bord Cloudflare, et Cloudflare coupe la connexion pendant la
 * poignée de main — ce que Node rend sous la forme ci-dessus, qui ne désigne
 * rien.
 *
 * Deux réponses, toutes deux vérifiées ici : les variables sont nettoyées à
 * la lecture, et ce qui ne peut pas être un nom d'hôte est refusé tout de
 * suite, avec le nom de la variable fautive.
 */

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(function (config) { this.config = config; this.send = jest.fn(); }),
  PutObjectCommand: jest.fn(function (p) { this.params = p; }),
  DeleteObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
  HeadBucketCommand: jest.fn(),
}));
jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const BASE = {
  R2_ACCOUNT_ID: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
  R2_ACCESS_KEY_ID: 'cle-publique',
  R2_SECRET_ACCESS_KEY: 'cle-secrete',
  R2_BUCKET_NAME: 'saambiz-public',
  R2_PRIVATE_BUCKET_NAME: 'saambiz-prive',
  R2_PUBLIC_URL: 'https://images.saambiz.com',
};

/** Recharge le module avec un environnement donné (le client est mémorisé). */
function avec(env) {
  jest.resetModules();
  for (const cle of Object.keys(BASE)) delete process.env[cle];
  Object.assign(process.env, env);
  return require('../../src/services/stockage/r2.service');
}

afterAll(() => {
  for (const cle of Object.keys(BASE)) delete process.env[cle];
});

describe('Les variables collées depuis le tableau de bord', () => {
  test('un identifiant de compte entouré d’espaces reste utilisable', async () => {
    // LA PANNE, en une ligne : collé avec un saut de ligne, cet identifiant
    // formait l'hôte « https://a1b2… \n.r2.cloudflarestorage.com ».
    const r2 = avec({ ...BASE, R2_ACCOUNT_ID: `  ${BASE.R2_ACCOUNT_ID}\n` });

    expect(r2.publicConfigure()).toBe(true);
    const { S3Client } = require('@aws-sdk/client-s3');
    await r2.envoyer(Buffer.from('x'), 'produits/2026/11/a.jpg').catch(() => {});

    expect(S3Client.mock.calls[0][0].endpoint)
      .toBe(`https://${BASE.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`);
  });

  test('une clé d’accès entourée d’espaces est nettoyée aussi', async () => {
    const r2 = avec({ ...BASE, R2_ACCESS_KEY_ID: ' cle-publique ' });
    const { S3Client } = require('@aws-sdk/client-s3');
    await r2.envoyer(Buffer.from('x'), 'produits/a.jpg').catch(() => {});

    expect(S3Client.mock.calls[0][0].credentials.accessKeyId).toBe('cle-publique');
  });

  test('un nom de bucket entouré d’espaces est nettoyé', async () => {
    const r2 = avec({ ...BASE, R2_BUCKET_NAME: ' saambiz-public ' });
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await r2.envoyer(Buffer.from('x'), 'produits/a.jpg').catch(() => {});

    expect(PutObjectCommand.mock.calls[0][0].Bucket).toBe('saambiz-public');
  });

  test('une adresse publique avec barre finale ne double pas la barre', () => {
    const r2 = avec({ ...BASE, R2_PUBLIC_URL: 'https://images.saambiz.com/ ' });
    expect(r2.adressePublique('produits/a.jpg'))
      .toBe('https://images.saambiz.com/produits/a.jpg');
  });
});

describe('Ce qui ne peut pas être un nom d’hôte est refusé tout de suite', () => {
  const mauvais = {
    'une adresse complète': 'https://a1b2c3.r2.cloudflarestorage.com',
    'une barre oblique': 'a1b2c3/saambiz',
    'une espace au milieu': 'a1b2 c3d4',
    'deux points': 'a1b2:c3d4',
  };

  for (const [quoi, valeur] of Object.entries(mauvais)) {
    test(`${quoi} lève une erreur qui nomme la variable`, async () => {
      const r2 = avec({ ...BASE, R2_ACCOUNT_ID: valeur });

      await expect(r2.envoyer(Buffer.from('x'), 'produits/a.jpg'))
        .rejects.toThrow(/R2_ACCOUNT_ID/);
    });
  }

  test('l’identifiant normal, lui, passe', () => {
    const r2 = avec(BASE);
    expect(r2.publicConfigure()).toBe(true);
  });
});

describe('Un envoi qui échoue dit ce qu’il a tenté de joindre', () => {
  test('l’hôte, le bucket et un indice voyagent avec l’erreur', async () => {
    const r2 = avec(BASE);
    const { S3Client } = require('@aws-sdk/client-s3');
    // La panne réelle, telle que Node la rend.
    const panne = new Error('write EPROTO … ssl/tls alert handshake failure … SSL alert number 40');
    panne.code = 'EPROTO';
    S3Client.mockImplementation(function () {
      this.send = jest.fn(async () => { throw panne; });
    });

    await expect(r2.envoyer(Buffer.from('x'), 'produits/a.jpg')).rejects.toMatchObject({
      hoteR2: `https://${BASE.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      bucketR2: 'saambiz-public',
      indice: expect.stringContaining('R2_ACCOUNT_ID'),
    });
  });

  test('des identifiants refusés donnent un autre indice', async () => {
    const r2 = avec(BASE);
    const { S3Client } = require('@aws-sdk/client-s3');
    S3Client.mockImplementation(function () {
      this.send = jest.fn(async () => { throw new Error('SignatureDoesNotMatch'); });
    });

    await expect(r2.envoyer(Buffer.from('x'), 'produits/a.jpg')).rejects.toMatchObject({
      indice: expect.stringContaining('R2_ACCESS_KEY_ID'),
    });
  });

  test('la clé secrète n’apparaît jamais dans l’erreur', async () => {
    // Ce qui part au journal part aussi chez l'agrégateur de logs.
    const r2 = avec(BASE);
    const { S3Client } = require('@aws-sdk/client-s3');
    S3Client.mockImplementation(function () {
      this.send = jest.fn(async () => { throw new Error('EPROTO'); });
    });

    const err = await r2.envoyer(Buffer.from('x'), 'produits/a.jpg').catch((e) => e);
    expect(JSON.stringify({ ...err, message: err.message })).not.toContain('cle-secrete');
  });
});
