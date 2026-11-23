/**
 * Trois heures de silence ferment la session.
 *
 * Le jeton de rafraîchissement vit dix ans, et c'était voulu : la session ne
 * se terminait que sur un geste — déconnexion, coupure d'un appareil,
 * dépassement du plafond de sessions. Jamais sur l'écoulement du temps. Un
 * téléphone reposé dix jours rouvrait donc directement sur le compte.
 *
 * Ce qui change : le silence compte désormais. Pas la durée de la session —
 * LE TEMPS ENTRE DEUX USAGES. C'est une fenêtre glissante : chaque
 * renouvellement la repousse, donc une journée entière de travail ne coupe
 * personne, alors qu'une nuit sans toucher au téléphone ferme la session.
 *
 * La mesure ne coûte rien : chaque rotation écrit une ligne neuve, donc
 * l'âge de la ligne courante EST le temps écoulé depuis le dernier usage.
 * Aucune colonne ajoutée, aucune écriture à chaque requête.
 */

const jwt = require('jsonwebtoken');

const mockFindOne = jest.fn();
const mockUpdate = jest.fn(async () => {});

jest.mock('../../src/models', () => ({
  RefreshToken: {
    findOne: (...a) => mockFindOne(...a),
    create: jest.fn(async (l) => ({ id: 'ligne-neuve', ...l })),
    update: jest.fn(async () => [0]),
    findAll: jest.fn(async () => []),
    findByPk: jest.fn(async () => null),
    count: jest.fn(async () => 0),
    destroy: jest.fn(async () => 0),
  },
}));
jest.mock('../../src/config/db', () => ({ define: jest.fn(() => ({})), transaction: jest.fn() }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

process.env.JWT_SECRET = 'un-secret-de-test-assez-long-pour-passer-le-controle';
process.env.JWT_REFRESH_SECRET = 'un-autre-secret-de-test-assez-long-et-distinct';

const { refreshTokenConfig, jwtConfig } = require('../../src/config/security');
const RefreshTokenService = require('../../src/services/refreshToken.service');

const MINUTE = 60 * 1000;
const HEURE = 60 * MINUTE;

const jetonPour = (id) => jwt.sign({ id }, jwtConfig.refreshSecret, { expiresIn: '3650d' });

/** Une ligne de session dont le dernier usage remonte à [ilYaMs]. */
function ligne(ilYaMs, extra = {}) {
  return {
    id: 'ligne-1',
    utilisateurId: 'u-1',
    createdAt: new Date(Date.now() - ilYaMs),
    expiresAt: new Date(Date.now() + 3650 * 24 * HEURE),
    revokedAt: null,
    rotatedAt: null,
    remplacePar: null,
    update: (...a) => mockUpdate(...a),
    ...extra,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('La règle', () => {
  test('une semaine, et c’est la valeur par défaut', () => {
    expect(refreshTokenConfig.inactiviteMaxMs).toBe(7 * 24 * HEURE);
  });

  test('une valeur absurde ne désactive pas la règle', () => {
    // Une variable d'environnement vide ou à zéro fermerait toutes les
    // sessions à la seconde près. Le plancher d'une minute l'empêche.
    expect(refreshTokenConfig.inactiviteMaxMs).toBeGreaterThanOrEqual(MINUTE);
  });
});

describe('Une session qui a servi récemment', () => {
  test('dix minutes de silence : elle continue', async () => {
    mockFindOne.mockResolvedValue(ligne(10 * MINUTE));

    const r = await RefreshTokenService.verifier(jetonPour('u-1'));

    expect(r.valide).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('six jours et vingt-trois heures : elle continue encore', async () => {
    // La limite doit être nette : on ne ferme pas « vers » une semaine.
    mockFindOne.mockResolvedValue(ligne(7 * 24 * HEURE - MINUTE));

    expect((await RefreshTokenService.verifier(jetonPour('u-1'))).valide).toBe(true);
  });

  test('une session ouverte il y a dix mois mais servie à l’instant', async () => {
    // Ce n'est pas l'âge de la SESSION qui compte, c'est le silence. Un
    // vendeur fidèle ne doit pas se reconnecter tous les matins.
    mockFindOne.mockResolvedValue(ligne(MINUTE, {
      expiresAt: new Date(Date.now() + 3000 * 24 * HEURE),
    }));

    expect((await RefreshTokenService.verifier(jetonPour('u-1'))).valide).toBe(true);
  });
});

describe('Une session restée silencieuse', () => {
  test('une semaine et une minute : elle est fermée', async () => {
    mockFindOne.mockResolvedValue(ligne(7 * 24 * HEURE + MINUTE));

    const r = await RefreshTokenService.verifier(jetonPour('u-1'));

    expect(r.valide).toBe(false);
    expect(r.inactivite).toBe(true);
    expect(r.motif).toMatch(/une semaine/i);
  });

  test('le jeton est révoqué, pas seulement refusé', async () => {
    // Refusé sans être révoqué, il resterait présentable indéfiniment.
    mockFindOne.mockResolvedValue(ligne(8 * 24 * HEURE));

    await RefreshTokenService.verifier(jetonPour('u-1'));

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ revokedAt: expect.any(Date) }),
    );
  });

  test('dix jours : fermée aussi, évidemment', async () => {
    // Le cas rapporté : « même après 10 jours ça entre directement ».
    mockFindOne.mockResolvedValue(ligne(10 * 24 * HEURE));

    expect((await RefreshTokenService.verifier(jetonPour('u-1'))).valide).toBe(false);
  });

  test('le délai de grâce ne la ressuscite pas', async () => {
    // La grâce existe pour un remplaçant perdu en chemin (réseau coupé
    // pendant la rotation), pas pour rouvrir ce que le temps a fermé.
    mockFindOne.mockResolvedValue(ligne(8 * 24 * HEURE, {
      rotatedAt: new Date(Date.now() - MINUTE),
    }));

    const r = await RefreshTokenService.faireTourner(jetonPour('u-1'));

    expect(r.valide).toBe(false);
    expect(r.inactivite).toBe(true);
  });
});

describe('Ce que l’inactivité ne change pas', () => {
  test('une session révoquée reste révoquée, avec son propre motif', async () => {
    mockFindOne.mockResolvedValue(ligne(MINUTE, { revokedAt: new Date() }));

    const r = await RefreshTokenService.verifier(jetonPour('u-1'));

    expect(r.valide).toBe(false);
    expect(r.inactivite).toBeUndefined();
    expect(r.motif).toMatch(/révoquée/i);
  });

  test('un jeton inconnu reste inconnu', async () => {
    mockFindOne.mockResolvedValue(null);

    const r = await RefreshTokenService.verifier(jetonPour('u-1'));

    expect(r.valide).toBe(false);
    expect(r.inactivite).toBeUndefined();
  });
});
