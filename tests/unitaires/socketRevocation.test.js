/**
 * Le temps réel doit respecter la révocation des jetons.
 *
 * `socketAuthMiddleware` ne vérifiait que la signature. Or un jeton d'accès
 * reste signé et non expiré après une déconnexion, un changement de mot de
 * passe ou une suppression de compte : ce sont la LISTE NOIRE et le statut du
 * compte qui coupent l'accès, et le middleware HTTP les consulte tous les
 * deux. Un jeton révoqué ouvrait donc encore un socket, rejoignait la salle
 * `user:<id>` et continuait d'y recevoir messages et notifications.
 */

const jwt = require('jsonwebtoken');

const mockBlacklistFindOne = jest.fn();
const mockUtilisateurFindByPk = jest.fn();

jest.mock('../../src/models/tokenBlacklist.model', () => ({
  findOne: (...a) => mockBlacklistFindOne(...a),
}));
jest.mock('../../src/models/utilisateur.model', () => ({
  findByPk: (...a) => mockUtilisateurFindByPk(...a),
}));
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(),
}));

const { jwtConfig } = require('../../src/config/security');

// Le middleware n'est pas exporté : on le récupère via l'instance Socket.IO
// que `initSocket` configure, en interceptant `io.use`.
let middleware;
jest.mock('socket.io', () => ({
  Server: class {
    use(fn) { middleware = fn; }
    on() {}
    in() { return { disconnectSockets: jest.fn() }; }
  },
}));

const { initSocket } = require('../../src/services/socket.service');

const UID = '11111111-0000-4000-8000-000000000001';
const jetonValide = () => jwt.sign({ id: UID }, jwtConfig.secret, { expiresIn: '1h' });

/** Rejoue la poignée de main et renvoie l'erreur éventuelle. */
async function poigneeDeMain(token) {
  const socket = { handshake: { auth: { token } } };
  let erreur;
  await middleware(socket, (e) => { erreur = e; });
  return { socket, erreur };
}

describe('Authentification de la poignée de main Socket.IO', () => {
  beforeAll(() => { initSocket({}); });

  beforeEach(() => {
    mockBlacklistFindOne.mockReset().mockResolvedValue(null);
    mockUtilisateurFindByPk.mockReset().mockResolvedValue({ id: UID, statut: 'actif' });
  });

  it('refuse un jeton révoqué (déconnexion, mot de passe changé)', async () => {
    mockBlacklistFindOne.mockResolvedValue({ token: 'peu-importe' });

    const { socket, erreur } = await poigneeDeMain(jetonValide());

    expect(erreur).toBeInstanceOf(Error);
    expect(socket.userId).toBeUndefined();
  });

  it('refuse le jeton d\'un compte suspendu', async () => {
    mockUtilisateurFindByPk.mockResolvedValue({ id: UID, statut: 'suspendu' });

    const { socket, erreur } = await poigneeDeMain(jetonValide());

    expect(erreur).toBeInstanceOf(Error);
    expect(socket.userId).toBeUndefined();
  });

  it('refuse le jeton d\'un compte supprimé', async () => {
    mockUtilisateurFindByPk.mockResolvedValue(null);

    const { socket, erreur } = await poigneeDeMain(jetonValide());

    expect(erreur).toBeInstanceOf(Error);
    expect(socket.userId).toBeUndefined();
  });

  it('refuse un jeton forgé sans toucher à la base', async () => {
    const { socket, erreur } = await poigneeDeMain(
      jwt.sign({ id: UID }, 'un-autre-secret-totalement-different-32c'),
    );

    expect(erreur).toBeInstanceOf(Error);
    expect(socket.userId).toBeUndefined();
    // La signature est contrôlée avant toute I/O.
    expect(mockBlacklistFindOne).not.toHaveBeenCalled();
  });

  it('refuse une poignée de main sans jeton', async () => {
    const { erreur } = await poigneeDeMain(undefined);
    expect(erreur).toBeInstanceOf(Error);
  });

  it('accepte un jeton valide d\'un compte actif', async () => {
    const { socket, erreur } = await poigneeDeMain(jetonValide());

    expect(erreur).toBeUndefined();
    expect(socket.userId).toBe(UID);
  });
});
