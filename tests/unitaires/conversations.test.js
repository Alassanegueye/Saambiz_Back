jest.mock('../../src/models', () => ({
  Message: { findAll: jest.fn() },
  MessageSite: {},
  Utilisateur: {},
  Boutique: {},
}));
jest.mock('../../src/config/db', () => ({}));
jest.mock('../../src/services/socket.service', () => ({ getIO: jest.fn() }));

const { Message } = require('../../src/models');
const MessageService = require('../../src/services/messagerie/message.service');

/** Liste des conversations (GET /messages/conversations). */
describe('MessageService.getConversations', () => {
  const acheteur = { id: 'a1', nom: 'Beye', prenom: 'Balla', photoProfil: null, boutiques: [] };
  const vendeur = {
    id: 'v1', nom: 'Diop', prenom: 'Alou', photoProfil: null,
    boutiques: [{ id: 'b1', nom: 'Aloushop', logo: 'https://cdn/logo.png' }],
  };
  const msg = (id, de, a, contenu, lu, date) => ({
    toJSON: () => ({
      id, contenu, lu, createdAt: date,
      expediteurId: de.id, destinataireId: a.id,
      expediteur: de, destinataire: a,
    }),
  });

  beforeEach(() => {
    Message.findAll.mockReset();
    Message.findAll.mockResolvedValue([
      msg('m3', vendeur, acheteur, 'Fils', false, '2026-11-12T13:34:00Z'),
      msg('m2', vendeur, acheteur, 'Bonjour', false, '2026-11-12T13:30:00Z'),
      msg('m1', acheteur, vendeur, 'Salut', true, '2026-11-12T13:00:00Z'),
    ]);
  });

  test('côté acheteur : l\'interlocuteur est le vendeur, avec sa boutique', async () => {
    const [c, ...reste] = await MessageService.getConversations('a1');
    expect(reste).toHaveLength(0);
    expect(c.interlocuteurId).toBe('v1');
    expect(c.interlocuteur).toEqual({
      id: 'v1', nom: 'Diop', prenom: 'Alou', photoProfil: null,
      boutique: { id: 'b1', nom: 'Aloushop', logo: 'https://cdn/logo.png' },
    });
    expect(c.contenu).toBe('Fils');
    expect(c.nombreNonLus).toBe(2);
  });

  test('côté vendeur : l\'interlocuteur est l\'acheteur, sans boutique', async () => {
    const [c] = await MessageService.getConversations('v1');
    expect(c.interlocuteurId).toBe('a1');
    expect(c.interlocuteur.prenom).toBe('Balla');
    expect(c.interlocuteur.boutique).toBeNull();
    expect(c.nombreNonLus).toBe(0);
  });

  test('la boutique de chaque participant est demandée', async () => {
    await MessageService.getConversations('a1');
    const { include } = Message.findAll.mock.calls[0][0];
    for (const participant of include) {
      expect(participant.include[0]).toMatchObject({ as: 'boutiques', attributes: ['id', 'nom', 'logo'] });
    }
  });
});
