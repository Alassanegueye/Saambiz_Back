/**
 * Les routes des sites vitrines, par HTTP : montées à la bonne adresse,
 * ouvertes au site Kodafrik (CORS), en texte brut pour navigator.sendBeacon,
 * et l'administration toujours derrière un jeton.
 */

jest.mock('../../src/services/sites/suivi.service', () => ({ enregistrer: jest.fn().mockResolvedValue(true) }));

const request = require('supertest');
const app = require('../../src/app');
const SuiviService = require('../../src/services/sites/suivi.service');

describe('POST /saambiz/v1/sites/:site/evenements', () => {
  it('accepte un envoi de navigator.sendBeacon (texte brut) depuis kodafrik.com', async () => {
    const corps = JSON.stringify({ s: 'visite1234abcd', t: 'page', c: '/' });
    const r = await request(app)
      .post('/saambiz/v1/sites/kodafrik/evenements')
      .set('Origin', 'https://kodafrik.com')
      .set('Content-Type', 'text/plain;charset=UTF-8')
      .set('User-Agent', 'Mozilla/5.0 Chrome/126')
      .send(corps);
    expect(r.status).toBe(204);
    expect(r.headers['access-control-allow-origin']).toBe('https://kodafrik.com');
    expect(SuiviService.enregistrer).toHaveBeenCalledWith('kodafrik', corps, expect.objectContaining({ userAgent: 'Mozilla/5.0 Chrome/126' }));
  });
});

describe('POST /saambiz/v1/sites/:site/messages', () => {
  it('répond 422 à une demande incomplète, lisible par le formulaire du site', async () => {
    const r = await request(app)
      .post('/saambiz/v1/sites/kodafrik/messages')
      .set('Origin', 'https://www.kodafrik.com')
      .send({ nom: 'F', email: 'x', message: 'court' });
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ success: false, message: expect.any(String) });
    expect(r.headers['access-control-allow-origin']).toBe('https://www.kodafrik.com');
  });
});

describe('Administration', () => {
  it.each([
    ['get', '/admin/sites/kodafrik/statistiques'],
    ['get', '/admin/sites/kodafrik/messages'],
    ['post', '/admin/sites/kodafrik/mails'],
    ['get', '/admin/sites/saambiz/vendeurs'],
  ])('%s %s exige un jeton', async (methode, chemin) => {
    const r = await request(app)[methode](`/saambiz/v1${chemin}`);
    expect(r.status).toBe(401);
  });
});
