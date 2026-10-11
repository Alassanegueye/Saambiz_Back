/**
 * Réglages publics, sortis de app.js vers route → contrôleur → service.
 *
 * Sans base de données, la lecture échoue : la route doit quand même
 * répondre 200 avec les valeurs par défaut, faute de quoi l'application
 * mobile afficherait à tort l'écran de mise à jour forcée.
 */
jest.mock('../../src/services/config/config.service', () => ({
  getPrixAbonnement: jest.fn().mockRejectedValue(new Error('base indisponible')),
  getConfigApplicationMobile: jest.fn().mockRejectedValue(new Error('base indisponible')),
}));

const request = require('supertest');
const app = require('../../src/app');

describe('Réglages publics', () => {
  it.each(['/saambiz/app/config', '/saambiz/v1/app/config', '/jendal/app/config'])(
    'GET %s répond 200 avec les valeurs par défaut',
    async (url) => {
      const res = await request(app).get(url);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        minVersionAndroid: '1.0.0',
        minVersionIos: '1.0.0',
        maintenance: false,
        message: null,
      });
    },
  );

  it('GET /saambiz/prix-abonnement répond le prix par défaut', async () => {
    const res = await request(app).get('/saambiz/prix-abonnement');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ prix: 2000, devise: 'FCFA' });
  });
});
