const crypto = require('crypto');
const WaveService = require('../../src/services/paiement/wave.service');

const SECRET = 'wave_sn_WHS_test';
const CORPS = '{"id":"EV_1","type":"checkout.session.completed"}';
const MAINTENANT = 1_800_000_000_000;
const T = String(MAINTENANT / 1000);
const signer = (t, corps, secret = SECRET) =>
  crypto.createHmac('sha256', secret).update(t + corps).digest('hex');

describe('WaveService.signatureValide', () => {
  const verifier = (entete, corps = CORPS) =>
    WaveService.signatureValide(entete, corps, SECRET, MAINTENANT);

  test('accepte une signature correcte', () => {
    expect(verifier(`t=${T},v1=${signer(T, CORPS)}`)).toBe(true);
  });

  test('accepte la bonne parmi plusieurs (changement de clé)', () => {
    expect(verifier(`t=${T},v1=${signer(T, CORPS, 'ancien')},v1=${signer(T, CORPS)}`)).toBe(true);
  });

  test('refuse un corps modifié', () => {
    expect(verifier(`t=${T},v1=${signer(T, CORPS)}`, `${CORPS} `)).toBe(false);
  });

  test('refuse un mauvais secret', () => {
    expect(verifier(`t=${T},v1=${signer(T, CORPS, 'autre')}`)).toBe(false);
  });

  test('refuse une notification de plus de cinq minutes', () => {
    const ancien = String(MAINTENANT / 1000 - 301);
    expect(verifier(`t=${ancien},v1=${signer(ancien, CORPS)}`)).toBe(false);
  });

  test('refuse un en-tête absent ou sans signature', () => {
    expect(verifier(undefined)).toBe(false);
    expect(verifier(`t=${T}`)).toBe(false);
  });

  test('sans secret configuré, rien ne passe', () => {
    expect(WaveService.signatureValide(`t=${T},v1=${signer(T, CORPS)}`, CORPS, '', MAINTENANT)).toBe(false);
  });
});
