/**
 * LE SUIVI PAR LIEN, DE BOUT EN BOUT : route → contrôleur → service.
 *
 * Trois comportements que le site public attend, et dont il dépend pour
 * afficher le bon écran :
 *
 *  • 200 — le lien est valable, voici les commandes ;
 *  • 410 — il a existé et il a expiré : « demandez-en un autre » ;
 *  • 404 — il n'a jamais existé : « ce lien est introuvable ».
 *
 * Confondre les deux derniers donnerait au client un message faux. Un lien
 * de quinze jours qui arrive à son terme est le cas NORMAL, pas une erreur.
 *
 * Et une quatrième, qui n'est pas d'ergonomie mais de confidentialité : la
 * demande d'un nouveau lien répond la même chose que l'adresse ait commandé
 * ou non. Autrement, la route dirait, adresse par adresse, qui est client de
 * quelle boutique.
 */

const mockOuvrir = jest.fn();
const mockEnvoyerLien = jest.fn();

jest.mock('../../src/services/vitrine/lienSuivi.service', () => ({
  ouvrir: (...a) => mockOuvrir(...a),
  dureeJours: 15,
}));

jest.mock('../../src/services/vitrine/vitrine.service', () => ({
  envoyerLienSuivi: (...a) => mockEnvoyerLien(...a),
}));

const request = require('supertest');
const app = require('../../src/app');

const URL = '/saambiz/v1/vitrine/suivi';

describe('suivi d’une commande par lien unique', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rend les commandes quand le lien est valable', async () => {
    mockOuvrir.mockResolvedValue({
      email: 'awa@exemple.sn',
      expireLe: new Date('2026-12-09'),
      commandeOuverte: 'cmd-1',
      commandes: [{ id: 'cmd-1', reference: '#1234', statut: 'en_preparation' }],
    });

    const res = await request(app).get(`${URL}/unJetonValide`);

    expect(res.status).toBe(200);
    expect(res.body.data.commandes).toHaveLength(1);
    expect(res.body.data.commandes[0].statut).toBe('en_preparation');
    expect(mockOuvrir).toHaveBeenCalledWith('unJetonValide');
  });

  it('répond 410 sur un lien expiré, pour que l’écran le dise', async () => {
    const expire = Object.assign(new Error('Ce lien de suivi a expiré.'), {
      status: 410,
      code: 'LIEN_EXPIRE',
    });
    mockOuvrir.mockRejectedValue(expire);

    const res = await request(app).get(`${URL}/unJetonPerime`);

    expect(res.status).toBe(410);
    expect(res.body.message).toMatch(/expir/i);
  });

  it('répond 404 sur un lien qui n’a jamais existé', async () => {
    const { NotFoundError } = require('../../src/errors/AppError');
    mockOuvrir.mockRejectedValue(new NotFoundError('Ce lien de suivi est introuvable.'));

    const res = await request(app).get(`${URL}/jetonInvente`);

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/introuvable/i);
  });

  it('répond la même chose que l’adresse ait commandé ou non', async () => {
    mockEnvoyerLien.mockResolvedValue(true);
    const connue = await request(app)
      .post(`${URL}/demander-lien`)
      .send({ email: 'awa@exemple.sn' });

    mockEnvoyerLien.mockResolvedValue(false);
    const inconnue = await request(app)
      .post(`${URL}/demander-lien`)
      .send({ email: 'personne@exemple.sn' });

    expect(connue.status).toBe(inconnue.status);
    expect(connue.body.message).toBe(inconnue.body.message);
    expect(connue.body.message).toMatch(/si des commandes existent/i);
  });
});
