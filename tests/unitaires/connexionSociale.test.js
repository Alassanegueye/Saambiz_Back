const crypto = require('crypto');
const jwt = require('jsonwebtoken');

jest.mock('axios', () => ({ get: jest.fn() }));
const axios = require('axios');

const ConnexionSociale = require('../../src/services/connexionSociale.service');

/**
 * Vérification des jetons Google / Apple.
 *
 * Une paire de clés RSA locale joue le rôle du fournisseur : sa clé publique
 * est servie comme JWKS par un axios simulé.
 */
describe('ConnexionSociale.verifier', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'cle-1', alg: 'RS256', use: 'sig' };
  const autre = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

  const signer = (charge, options = {}) => jwt.sign(charge, options.cle || privateKey, {
    algorithm: 'RS256',
    keyid: 'cle-1',
    expiresIn: '10m',
    ...options.jwt,
  });

  const googleValide = (extra = {}) => ({
    iss: 'https://accounts.google.com',
    aud: 'client-ios.apps.googleusercontent.com',
    sub: '1234',
    email: 'Awa.Diop@Gmail.com',
    email_verified: true,
    given_name: 'Awa',
    family_name: 'Diop',
    ...extra,
  });

  beforeEach(() => {
    ConnexionSociale._cache.clear();
    axios.get.mockReset();
    axios.get.mockResolvedValue({ data: { keys: [jwk] } });
    process.env.GOOGLE_CLIENT_IDS = 'client-ios.apps.googleusercontent.com, client-web.apps.googleusercontent.com';
    delete process.env.APPLE_CLIENT_IDS;
  });

  test('accepte un jeton Google valide et renvoie l\'adresse en minuscules', async () => {
    const identite = await ConnexionSociale.verifier('google', signer(googleValide()));
    expect(identite).toEqual({ sujet: '1234', email: 'awa.diop@gmail.com', prenom: 'Awa', nom: 'Diop' });
  });

  test('accepte le second identifiant client configuré (Android)', async () => {
    const jeton = signer(googleValide({ aud: 'client-web.apps.googleusercontent.com' }));
    await expect(ConnexionSociale.verifier('google', jeton)).resolves.toMatchObject({ sujet: '1234' });
  });

  test('refuse un jeton émis pour une autre application', async () => {
    const jeton = signer(googleValide({ aud: 'appli-pirate.apps.googleusercontent.com' }));
    await expect(ConnexionSociale.verifier('google', jeton)).rejects.toThrow('identité non vérifiée');
  });

  test('refuse un jeton signé par une autre clé', async () => {
    const jeton = signer(googleValide(), { cle: autre.privateKey });
    await expect(ConnexionSociale.verifier('google', jeton)).rejects.toThrow('identité non vérifiée');
  });

  test('refuse un jeton expiré', async () => {
    const jeton = signer(googleValide(), { jwt: { expiresIn: -10 } });
    await expect(ConnexionSociale.verifier('google', jeton)).rejects.toThrow('identité non vérifiée');
  });

  test('refuse un mauvais émetteur', async () => {
    const jeton = signer(googleValide({ iss: 'https://faux.example.com' }));
    await expect(ConnexionSociale.verifier('google', jeton)).rejects.toThrow('identité non vérifiée');
  });

  test('refuse une adresse non vérifiée par le fournisseur', async () => {
    const jeton = signer(googleValide({ email_verified: false }));
    await expect(ConnexionSociale.verifier('google', jeton)).rejects.toThrow('pas vérifiée');
  });

  test('refuse Google quand le serveur n\'est pas configuré', async () => {
    process.env.GOOGLE_CLIENT_IDS = '';
    await expect(ConnexionSociale.verifier('google', signer(googleValide())))
      .rejects.toThrow("n'est pas activée");
  });

  test('refuse un fournisseur inconnu', async () => {
    await expect(ConnexionSociale.verifier('facebook', 'x')).rejects.toThrow('inconnu');
  });

  describe('Apple', () => {
    const appleValide = (nonce, extra = {}) => ({
      iss: 'https://appleid.apple.com',
      aud: 'com.saambiz.app',
      sub: '000123.abc',
      email: 'x7k2@privaterelay.appleid.com',
      email_verified: 'true',
      nonce: crypto.createHash('sha256').update(nonce).digest('hex'),
      ...extra,
    });

    test('accepte un jeton dont le nonce correspond (bundle par défaut)', async () => {
      const identite = await ConnexionSociale.verifier('apple', signer(appleValide('graine')), { nonce: 'graine' });
      expect(identite.email).toBe('x7k2@privaterelay.appleid.com');
    });

    test('refuse un jeton rejoué avec un autre nonce', async () => {
      await expect(ConnexionSociale.verifier('apple', signer(appleValide('graine')), { nonce: 'autre' }))
        .rejects.toThrow('identité non vérifiée');
    });
  });

  test('recharge les clés une seule fois tant qu\'elles sont en cache', async () => {
    await ConnexionSociale.verifier('google', signer(googleValide()));
    await ConnexionSociale.verifier('google', signer(googleValide()));
    expect(axios.get).toHaveBeenCalledTimes(1);
  });
});
