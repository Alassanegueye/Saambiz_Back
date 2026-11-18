/**
 * Un message reçu arrive sur le téléphone, même application fermée.
 *
 * C'était le plus gros trou du système de notifications : envoyer un message
 * n'émettait qu'un événement temps réel, qui n'atteint que les applications
 * OUVERTES. Un vendeur dont le téléphone était dans la poche n'apprenait
 * jamais qu'un client lui écrivait — il le découvrait en rouvrant
 * l'application, des heures plus tard. Pour une marketplace, c'est une vente
 * perdue à chaque message.
 *
 * DÉLIBÉRÉMENT PAS DE LIGNE DANS LE CENTRE DE NOTIFICATIONS. Une
 * conversation, c'est dix messages en deux minutes : dix lignes y noieraient
 * tout le reste. Et l'application a déjà sa liste de conversations avec sa
 * pastille de non-lus — une seconde liste à côté donnerait deux états « lu »
 * à tenir d'accord, et marquer la notification comme lue ne marquerait pas
 * le message comme lu. C'est le seul endroit qui envoie un push sans écrire
 * de notification, et ce fichier dit pourquoi.
 */

const mockPush = jest.fn(async () => {});
const mockCreerNotification = jest.fn();
const mockEmit = jest.fn();
const mockMessageCreate = jest.fn();
const mockUtilisateurFindByPk = jest.fn();

jest.mock('../../src/models', () => ({
  Message: { create: (...a) => mockMessageCreate(...a), findAll: jest.fn() },
  MessageSite: {},
  Utilisateur: { findByPk: (...a) => mockUtilisateurFindByPk(...a) },
  Boutique: {},
}));
jest.mock('../../src/config/db', () => ({
  transaction: jest.fn(),
  define: jest.fn(() => ({})),
  fn: jest.fn(),
  col: jest.fn(),
  literal: jest.fn(),
}));
jest.mock('../../src/services/socket.service', () => ({
  getIO: () => ({ to: () => ({ emit: (...a) => mockEmit(...a) }) }),
}));
jest.mock('../../src/services/push.service', () => ({
  sendPushToUsers: (...a) => mockPush(...a),
}));
jest.mock('../../src/services/notifications/notification.service', () => ({
  creerNotification: (...a) => mockCreerNotification(...a),
}));

const MessageService = require('../../src/services/messagerie/message.service');

const vider = () => new Promise((r) => setImmediate(r));

const VENDEUR = {
  id: 'vendeur-1',
  nom: 'Diop',
  prenom: 'Awa',
  photoProfil: 'https://img/awa.jpg',
  boutiques: [{ nom: 'Chez Awa', logo: 'https://img/logo.jpg' }],
};

const ACHETEUR = {
  id: 'acheteur-1',
  nom: 'Ndiaye',
  prenom: 'Moussa',
  photoProfil: null,
  boutiques: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockMessageCreate.mockImplementation(async (champs) => ({ id: 'msg-1', ...champs }));
  mockUtilisateurFindByPk.mockImplementation(async (id) => {
    if (id === 'vendeur-1') return VENDEUR;
    if (id === 'acheteur-1') return ACHETEUR;
    return null;
  });
});

describe('Envoyer un message', () => {
  test('prévient le destinataire sur son téléphone', async () => {
    await MessageService.envoyerMessage('acheteur-1', {
      destinataireId: 'vendeur-1',
      contenu: 'Bonjour, ce sac est-il encore disponible ?',
    });
    await vider();

    expect(mockPush).toHaveBeenCalledTimes(1);
    const [destinataire, charge] = mockPush.mock.calls[0];
    expect(destinataire).toBe('vendeur-1');
    expect(charge.body).toBe('Bonjour, ce sac est-il encore disponible ?');
  });

  test('la notification ouvre LA conversation, pas la liste', async () => {
    // `interlocuteurId` est ce que le téléphone lit pour viser l'écran. Sans
    // lui, le toucher retombait sur la liste des conversations, et il fallait
    // retrouver soi-même qui avait écrit.
    await MessageService.envoyerMessage('acheteur-1', {
      destinataireId: 'vendeur-1',
      contenu: 'Bonjour',
    });
    await vider();

    const { data } = mockPush.mock.calls[0][1];
    expect(data.interlocuteurId).toBe('acheteur-1');
    expect(data.interlocuteurNom).toBe('Moussa Ndiaye');
  });

  test('un vendeur écrit au nom de sa boutique', async () => {
    // Le client reconnaît « Chez Awa », pas le nom personnel de la vendeuse.
    await MessageService.envoyerMessage('vendeur-1', {
      destinataireId: 'acheteur-1',
      contenu: 'Oui, il reste deux pièces.',
    });
    await vider();

    const charge = mockPush.mock.calls[0][1];
    expect(charge.title).toBe('Chez Awa');
    expect(charge.image).toBe('https://img/logo.jpg');
    expect(charge.data.interlocuteurNom).toBe('Chez Awa');
  });

  test('un message long est coupé, pas envoyé en entier', async () => {
    // Une bannière de téléphone n'affiche que deux lignes ; le reste est du
    // poids transporté pour rien.
    await MessageService.envoyerMessage('acheteur-1', {
      destinataireId: 'vendeur-1',
      contenu: 'a'.repeat(400),
    });
    await vider();

    const { body } = mockPush.mock.calls[0][1];
    expect(body.length).toBeLessThanOrEqual(120);
    expect(body.endsWith('…')).toBe(true);
  });

  test('aucune ligne n’est écrite dans le centre de notifications', async () => {
    // Le choix assumé : la liste des conversations tient déjà ce rôle.
    await MessageService.envoyerMessage('acheteur-1', {
      destinataireId: 'vendeur-1',
      contenu: 'Bonjour',
    });
    await vider();

    expect(mockCreerNotification).not.toHaveBeenCalled();
  });

  test('le temps réel part toujours, lui aussi', async () => {
    // Il reste le chemin le plus rapide quand l'application est ouverte.
    await MessageService.envoyerMessage('acheteur-1', {
      destinataireId: 'vendeur-1',
      contenu: 'Bonjour',
    });

    expect(mockEmit).toHaveBeenCalledWith('message:new', expect.any(Object));
  });
});

describe('Ce qui ne déclenche rien', () => {
  test('un destinataire inconnu : pas de message, pas de push', async () => {
    const resultat = await MessageService.envoyerMessage('acheteur-1', {
      destinataireId: 'fantome',
      contenu: 'Bonjour',
    });
    await vider();

    expect(resultat.success).toBe(false);
    expect(mockMessageCreate).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  test('un message à soi-même ne se notifie pas', async () => {
    await MessageService.envoyerMessage('vendeur-1', {
      destinataireId: 'vendeur-1',
      contenu: 'note pour moi',
    });
    await vider();

    expect(mockPush).not.toHaveBeenCalled();
  });

  test('un push refusé ne fait pas échouer l’envoi', async () => {
    // Le message est enregistré : une panne de Firebase ne doit pas le
    // perdre, ni rendre une erreur à celui qui vient de l'écrire.
    mockPush.mockRejectedValue(new Error('Firebase indisponible'));

    const resultat = await MessageService.envoyerMessage('acheteur-1', {
      destinataireId: 'vendeur-1',
      contenu: 'Bonjour',
    });
    await vider();

    expect(resultat.success).toBe(true);
  });
});
