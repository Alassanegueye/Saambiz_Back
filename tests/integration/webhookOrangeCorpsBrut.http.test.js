/**
 * Webhook Orange Money : le corps brut est conservé AUX DEUX ADRESSES.
 *
 * Défaut M-04 de l'audit du 23 novembre 2026. Le routeur d'API est exposé
 * deux fois — `/saambiz/v1/…`, l'adresse de référence, et `/saambiz/…`,
 * l'alias que les applications déjà installées appellent encore. Le corps
 * brut, lui, n'était collecté que par un middleware monté sur le second
 * préfixe.
 *
 * Sur l'adresse de référence, `req.rawBody` était donc absent, et
 * `OrangeMoneyService.validerSignature` retombait sur
 * `JSON.stringify(req.body)` : une RÉ-SÉRIALISATION. Elle rend les octets
 * d'origine seulement si l'émetteur a envoyé du JSON compact — même ordre de
 * clés, aucun espace, mêmes échappements. Dès que le corps est présenté
 * autrement, l'empreinte diffère et la notification est rejetée. Pas de
 * contournement possible (le HMAC reste infalsifiable), mais un paiement
 * encaissé côté opérateur et jamais confirmé côté SaamBiz.
 *
 * ── CE QUI REND CE TEST CONCLUANT ─────────────────────────────────────────
 *
 * Le corps est envoyé en JSON INDENTÉ. C'est le point : avec du JSON compact,
 * `JSON.stringify(req.body)` rend par chance les mêmes octets, et le test
 * passerait aussi avec l'ancien code — il ne prouverait rien. L'indentation
 * crée l'écart que seule la conservation du corps brut franchit.
 */

process.env.ORANGE_WEBHOOK_SECRET = 'secret-de-test-pour-le-webhook-orange';

const mockConfirmerPaiement = jest.fn();
jest.mock('../../src/services/paiement/paiement.service', () => ({
  confirmerPaiement: (...args) => mockConfirmerPaiement(...args),
}));

const crypto = require('crypto');
const request = require('supertest');
const app = require('../../src/app');

const CORPS = { status: 'SUCCESS', order_id: 'CMD-2026-ABC123', pay_token: 'jeton-secret-orange' };

/** Le corps tel qu'Orange l'enverrait, mis en forme — donc pas compact. */
const CORPS_BRUT = JSON.stringify(CORPS, null, 2);

function signer(corpsBrut) {
  return crypto
    .createHmac('sha256', process.env.ORANGE_WEBHOOK_SECRET)
    .update(corpsBrut)
    .digest('hex');
}

const ADRESSES = [
  ['adresse de référence', '/saambiz/v1/paiement/webhook/orange'],
  ['alias historique', '/saambiz/paiement/webhook/orange'],
];

describe('Webhook Orange — conservation du corps brut', () => {
  beforeEach(() => mockConfirmerPaiement.mockReset());

  for (const [nom, url] of ADRESSES) {
    describe(nom, () => {
      it('accepte une signature calculée sur le corps brut indenté', async () => {
        const res = await request(app)
          .post(url)
          .set('Content-Type', 'application/json')
          .set('x-orange-signature', signer(CORPS_BRUT))
          .send(CORPS_BRUT);

        expect(res.status).toBe(200);
        expect(mockConfirmerPaiement).toHaveBeenCalledWith(
          expect.objectContaining({
            orderId: 'CMD-2026-ABC123',
            status: 'SUCCESS',
          }),
        );
      });

      it('refuse toujours une signature qui ne correspond pas', async () => {
        const res = await request(app)
          .post(url)
          .set('Content-Type', 'application/json')
          .set('x-orange-signature', signer('un-autre-corps'))
          .send(CORPS_BRUT);

        expect(res.status).toBe(400);
        expect(mockConfirmerPaiement).not.toHaveBeenCalled();
      });

      it('refuse toujours une notification sans signature', async () => {
        const res = await request(app)
          .post(url)
          .set('Content-Type', 'application/json')
          .send(CORPS_BRUT);

        expect(res.status).toBe(400);
        expect(mockConfirmerPaiement).not.toHaveBeenCalled();
      });

      it('ne renvoie jamais le jeton de paiement reçu', async () => {
        const res = await request(app)
          .post(url)
          .set('Content-Type', 'application/json')
          .set('x-orange-signature', signer(CORPS_BRUT))
          .send(CORPS_BRUT);

        expect(JSON.stringify(res.body)).not.toContain('jeton-secret-orange');
      });
    });
  }

  it('le corps brut est aussi conservé pour Wave, sur les deux adresses', async () => {
    // Même règle, même endroit : la condition couvre les deux opérateurs.
    // Sans signature valide, Wave répond 401 — ce qui prouve que la route est
    // atteinte et que la vérification a bien lieu.
    for (const url of [
      '/saambiz/v1/paiement/webhook/wave',
      '/saambiz/paiement/webhook/wave',
    ]) {
      const res = await request(app)
        .post(url)
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ type: 'checkout.session.completed' }, null, 2));

      expect(res.status).toBe(401);
    }
  });
});
