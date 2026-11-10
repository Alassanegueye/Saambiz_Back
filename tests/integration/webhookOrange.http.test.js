/**
 * Webhook Orange Money : ce que ce point d'entrée public ne doit PAS faire.
 *
 * Il est appelé par Orange, donc ouvert à tout le monde : aucune
 * authentification ne le protège, seule la signature HMAC le fait. Deux
 * régressions sont donc faciles et coûteuses :
 *
 *  1. renvoyer le message d'erreur interne à l'appelant — un message
 *     Sequelize nomme les tables et les colonnes ;
 *  2. confirmer un paiement sans signature valide.
 */

process.env.ORANGE_WEBHOOK_SECRET = 'secret-de-test-pour-le-webhook-orange';

// Préfixe `mock` exigé par Jest pour une variable citée dans une fabrique
// de module : c'est le garde-fou contre les mocks encore non initialisés.
const mockConfirmerPaiement = jest.fn();
jest.mock('../../src/services/paiement/paiement.service', () => ({
  confirmerPaiement: (...args) => mockConfirmerPaiement(...args),
}));

const request = require('supertest');
const app = require('../../src/app');

const CORPS = { status: 'SUCCESS', order_id: 'CMD-1', pay_token: 'jeton-secret-orange' };

describe('Webhook Orange Money', () => {
  beforeEach(() => mockConfirmerPaiement.mockReset());

  it('refuse une notification sans signature', async () => {
    const res = await request(app)
      .post('/saambiz/v1/paiement/webhook/orange')
      .send(CORPS);

    expect(res.status).toBe(400);
    // Et surtout : aucun paiement n'a été confirmé.
    expect(mockConfirmerPaiement).not.toHaveBeenCalled();
  });

  it('refuse une signature qui ne correspond pas', async () => {
    const res = await request(app)
      .post('/saambiz/v1/paiement/webhook/orange')
      .set('x-orange-signature', 'a'.repeat(64))
      .send(CORPS);

    expect(res.status).toBe(400);
    expect(mockConfirmerPaiement).not.toHaveBeenCalled();
  });

  it('ne renvoie jamais de message d\'erreur interne', async () => {
    // Même sur un refus, la réponse ne doit porter aucun détail technique.
    const res = await request(app)
      .post('/saambiz/v1/paiement/webhook/orange')
      .send({ nawak: true });

    const corps = JSON.stringify(res.body).toLowerCase();
    for (const fuite of ['sequelize', 'select', 'column', 'relation', 'stack', 'at ']) {
      expect(corps).not.toContain(fuite);
    }
  });

  it('ne renvoie pas le jeton de paiement reçu', async () => {
    const res = await request(app)
      .post('/saambiz/v1/paiement/webhook/orange')
      .send(CORPS);

    expect(JSON.stringify(res.body)).not.toContain('jeton-secret-orange');
  });
});
