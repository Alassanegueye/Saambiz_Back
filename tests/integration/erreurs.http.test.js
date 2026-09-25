/**
 * Chaîne d'erreur de bout en bout : contrôleur → asyncHandler → gestionnaire
 * global.
 *
 * Ces routes ne touchent pas la base : elles échouent avant, ce qui permet de
 * vérifier le format de réponse sans dépendre d'un PostgreSQL démarré.
 */
const request = require('supertest');
const app = require('../../src/app');

describe('Format des réponses d\'erreur', () => {
  it('renvoie 400 et le corps normalisé quand un champ requis manque', async () => {
    const res = await request(app)
      .post('/saambiz/v1/auth/refresh')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Le refresh token est requis');
  });

  it('renvoie 400 sur un corps JSON malformé', async () => {
    const res = await request(app)
      .post('/saambiz/v1/auth/refresh')
      .set('Content-Type', 'application/json')
      .send('{"refreshToken":');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('refuse une route protégée sans jeton', async () => {
    const res = await request(app).get('/saambiz/v1/account/me');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('renvoie 401 sur un jeton illisible plutôt qu\'un 500', async () => {
    const res = await request(app)
      .get('/saambiz/v1/account/me')
      .set('Authorization', 'Bearer pas-un-jeton');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('sert encore le préfixe historique en annonçant sa dépréciation', async () => {
    const res = await request(app)
      .post('/saambiz/auth/refresh')
      .send({});

    expect(res.status).toBe(400);
    expect(res.headers.deprecation).toBe('true');
  });
});
