/**
 * Les trois silences de l'envoi push.
 *
 * Quand un utilisateur dit « je ne reçois rien », il faut pouvoir répondre
 * lequel des trois cas s'est produit :
 *
 *   1. Firebase n'est pas initialisé sur le serveur ;
 *   2. personne n'a d'appareil enregistré ;
 *   3. Firebase a répondu, mais a refusé les jetons un par un.
 *
 * Les trois sortaient sans un mot — le premier par un `return` nu, le
 * deuxième aussi, le troisième parce que `sendEachForMulticast` répond 200
 * même quand tous les envois échouent, et que seul le compte des réussites
 * était journalisé.
 *
 * Ces tests figent la trace de chacun. Ils vérifient aussi qu'aucun jeton
 * complet n'atteint les journaux : un jeton d'appareil recopié sur disque,
 * exporté puis relu, c'est une donnée de trop.
 */

const JETON = 'cZk9QwErTyUiOpAsDfGhJkLxxxxxxxxABCD1234';

jest.mock('../../src/models/deviceToken.model', () => ({
  findAll: (...a) => mockFindAll(...a),
  destroy: (...a) => mockDestroy(...a),
  upsert: (...a) => mockUpsert(...a),
}));

jest.mock('../../src/utils/logger', () => ({
  info: (...a) => mockInfo(...a),
  warn: (...a) => mockWarn(...a),
  error: (...a) => mockErreur(...a),
}));

jest.mock('firebase-admin/app', () => ({
  initializeApp: jest.fn(),
  getApps: () => [],
  cert: jest.fn(),
}));

jest.mock('firebase-admin/messaging', () => ({
  getMessaging: () => ({ sendEachForMulticast: (...a) => mockEnvoi(...a) }),
}));

const mockFindAll = jest.fn();
const mockDestroy = jest.fn().mockResolvedValue(1);
const mockUpsert = jest.fn().mockResolvedValue(undefined);
const mockInfo = jest.fn();
const mockWarn = jest.fn();
const mockErreur = jest.fn();
const mockEnvoi = jest.fn();

/** Charge le service avec, ou sans, compte de service Firebase. */
function chargerService({ avecFirebase }) {
  jest.resetModules();
  if (avecFirebase) {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: 'test' });
  } else {
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  }
  return require('../../src/services/push.service');
}

/** Toutes les chaînes passées aux journaux, aplaties. */
const toutLeJournal = () =>
  JSON.stringify([mockInfo.mock.calls, mockWarn.mock.calls, mockErreur.mock.calls]);

beforeEach(() => {
  jest.clearAllMocks();
  mockDestroy.mockResolvedValue(1);
});

describe('Silence 1 — Firebase non initialisé', () => {
  test('l’envoi est ignoré, et le journal dit pourquoi', async () => {
    const push = chargerService({ avecFirebase: false });

    await push.sendPushToUsers('u1', { title: 'Promo', body: 'x' });

    expect(mockEnvoi).not.toHaveBeenCalled();
    const [message, meta] = mockWarn.mock.calls.at(-1);
    expect(message).toMatch(/Firebase Admin non initialis/);
    expect(meta.raison).toMatch(/FIREBASE_SERVICE_ACCOUNT_JSON absent/);
    expect(meta.titre).toBe('Promo');
  });
});

describe('Silence 2 — aucun appareil enregistré', () => {
  test('le journal nomme les utilisateurs concernés', async () => {
    const push = chargerService({ avecFirebase: true });
    mockFindAll.mockResolvedValue([]);

    await push.sendPushToUsers(['u1', 'u2'], { title: 'Commande', body: 'x' });

    expect(mockEnvoi).not.toHaveBeenCalled();
    const [message, meta] = mockWarn.mock.calls.at(-1);
    expect(message).toMatch(/aucun appareil enregistr/);
    expect(meta.utilisateurs).toEqual(['u1', 'u2']);
  });
});

describe('Silence 3 — Firebase refuse les jetons', () => {
  test('chaque refus est journalisé avec son code', async () => {
    const push = chargerService({ avecFirebase: true });
    mockFindAll.mockResolvedValue([{ token: JETON, platform: 'ios' }]);
    mockEnvoi.mockResolvedValue({
      successCount: 0,
      responses: [
        {
          success: false,
          // Le code d'un iPhone muet : clé APNs absente dans Firebase.
          error: { code: 'messaging/third-party-auth-error', message: 'APNs' },
        },
      ],
    });

    await push.sendPushToUsers('u1', { title: 'Message', body: 'x' });

    const [message, meta] = mockErreur.mock.calls.at(-1);
    expect(message).toMatch(/refus/);
    expect(meta.refuses).toBe(1);
    expect(meta.detail[0].code).toBe('messaging/third-party-auth-error');
    expect(meta.detail[0].plateforme).toBe('ios');
  });

  test('un envoi réussi ne produit aucune erreur', async () => {
    const push = chargerService({ avecFirebase: true });
    mockFindAll.mockResolvedValue([{ token: JETON, platform: 'android' }]);
    mockEnvoi.mockResolvedValue({ successCount: 1, responses: [{ success: true }] });

    await push.sendPushToUsers('u1', { title: 'Promo', body: 'x' });

    expect(mockErreur).not.toHaveBeenCalled();
    expect(mockInfo.mock.calls.some(([m]) => /1\/1 notif/.test(m))).toBe(true);
  });
});

describe('Les jetons ne fuient pas dans les journaux', () => {
  test('seuls les huit derniers caractères apparaissent', async () => {
    const push = chargerService({ avecFirebase: true });
    mockFindAll.mockResolvedValue([{ token: JETON, platform: 'android' }]);
    mockEnvoi.mockResolvedValue({
      successCount: 0,
      responses: [{ success: false, error: { code: 'messaging/invalid-argument' } }],
    });

    await push.sendPushToUsers('u1', { title: 'x', body: 'y' });

    const journal = toutLeJournal();
    expect(journal).not.toContain(JETON);
    expect(journal).toContain('…ABCD1234');
  });

  test('l’enregistrement d’un appareil est tracé, sans le jeton', async () => {
    const push = chargerService({ avecFirebase: true });

    await push.saveDeviceToken('u1', JETON, 'android');

    expect(mockUpsert).toHaveBeenCalled();
    const journal = toutLeJournal();
    expect(journal).toContain('appareil enregistré');
    expect(journal).not.toContain(JETON);
    expect(journal).toContain('…ABCD1234');
  });
});
