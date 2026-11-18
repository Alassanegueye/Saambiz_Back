/**
 * Ce que le serveur envoie vraiment à Firebase, et ce qu'il fait des refus.
 *
 * C'est le seul endroit où l'on peut vérifier, sans téléphone, que la charge
 * utile est celle qui s'affiche écran verrouillé : un bloc `notification`
 * (et pas seulement des `data`, que le système n'affiche jamais de lui-même),
 * la priorité haute d'Android, la priorité 10 d'APNs, et le canal que
 * l'application a créé.
 *
 * Les refus sont de trois sortes, et chacune demande autre chose :
 *   - jeton périmé    → on le supprime, l'appareil n'existe plus ;
 *   - refus passager  → on réessaie une fois, deux secondes plus tard ;
 *   - refus définitif → on le journalise, et on n'insiste pas.
 */

const mockSendEach = jest.fn();
const mockDestroy = jest.fn(async () => 0);
const mockFindAll = jest.fn();
const mockErreurs = [];

jest.mock('firebase-admin/app', () => ({
  initializeApp: jest.fn(),
  getApps: jest.fn(() => [{}]),
  cert: jest.fn(),
}));
jest.mock('firebase-admin/messaging', () => ({
  getMessaging: () => ({ sendEachForMulticast: (...a) => mockSendEach(...a) }),
}));
jest.mock('../../src/models/deviceToken.model', () => ({
  findAll: (...a) => mockFindAll(...a),
  destroy: (...a) => mockDestroy(...a),
}));
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: (...a) => mockErreurs.push(a),
}));

// Une clé de service bien formée : sans elle le module se désactive et
// n'envoie rien, ce qui ferait passer tous les tests pour de mauvaises
// raisons. La valeur n'est jamais utilisée — firebase-admin est simulé.
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
  project_id: 'saambiz-test',
  client_email: 'test@saambiz-test.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
});
// Pas d'attente réelle entre les deux essais : le test ne doit pas dormir.
process.env.FCM_DELAI_SECOND_ESSAI_MS = '0';

const { sendPushToUsers } = require('../../src/services/push.service');

const ok = () => ({ success: true });
const ko = (code) => ({ success: false, error: { code, message: code } });

beforeEach(() => {
  jest.clearAllMocks();
  mockErreurs.length = 0;
  mockFindAll.mockResolvedValue([
    { token: 'jeton-android', platform: 'android' },
    { token: 'jeton-ios', platform: 'ios' },
  ]);
  mockSendEach.mockResolvedValue({ successCount: 2, responses: [ok(), ok()] });
});

describe('La charge utile', () => {
  test('porte un bloc « notification », pas seulement des données', async () => {
    // C'est ce bloc, et lui seul, qui fait afficher la notification par le
    // système quand l'application est fermée ou le téléphone verrouillé. Un
    // message « data only » n'est remis qu'au code de l'application, qui ne
    // tourne pas à ce moment-là : l'écran reste noir.
    await sendPushToUsers('u1', { title: 'Commande prête', body: 'Passez la récupérer.' });

    const envoi = mockSendEach.mock.calls[0][0];
    expect(envoi.notification).toEqual({
      title: 'Commande prête',
      body: 'Passez la récupérer.',
    });
  });

  test('demande à Android la priorité haute et le bon canal', async () => {
    // Sans la priorité haute, Android retient le message pendant la veille.
    // Un canal inconnu de l'application, et la notification n'apparaît pas.
    await sendPushToUsers('u1', { title: 'T', body: 'B' });

    const { android } = mockSendEach.mock.calls[0][0];
    expect(android.priority).toBe('high');
    expect(android.notification.channelId).toBe('saambiz_push_channel');
    expect(android.notification.sound).toBe('default');
  });

  test('demande à APNs la livraison immédiate et un son', async () => {
    // `apns-priority: 10` = tout de suite ; le son fait apparaître la
    // bannière sur l'écran verrouillé plutôt qu'une remise silencieuse.
    await sendPushToUsers('u1', { title: 'T', body: 'B' });

    const { apns } = mockSendEach.mock.calls[0][0];
    expect(apns.headers['apns-priority']).toBe('10');
    expect(apns.payload.aps.sound).toBe('default');
  });

  test('les données sont toutes des chaînes', async () => {
    // FCM refuse la charge entière si une valeur de `data` n'en est pas une.
    await sendPushToUsers('u1', {
      title: 'T',
      body: 'B',
      data: { commandeId: 'cmd-1', pourVendeur: false, nombre: 3, vide: null },
    });

    const { data } = mockSendEach.mock.calls[0][0];
    expect(data).toEqual({ commandeId: 'cmd-1', pourVendeur: 'false', nombre: '3' });
  });

  test('n’est envoyée qu’aux appareils du destinataire', async () => {
    await sendPushToUsers(['u1', 'u2'], { title: 'T', body: 'B' });

    expect(mockFindAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: { utilisateurId: ['u1', 'u2'] } }),
    );
    expect(mockSendEach.mock.calls[0][0].tokens).toEqual(['jeton-android', 'jeton-ios']);
  });
});

describe('Les refus', () => {
  test('un jeton périmé est supprimé', async () => {
    mockSendEach.mockResolvedValue({
      successCount: 1,
      responses: [ok(), ko('messaging/registration-token-not-registered')],
    });

    await sendPushToUsers('u1', { title: 'T', body: 'B' });

    expect(mockDestroy).toHaveBeenCalledWith({ where: { token: ['jeton-ios'] } });
  });

  test('un refus passager vaut un second essai, sur ce seul appareil', async () => {
    mockSendEach
      .mockResolvedValueOnce({
        successCount: 1,
        responses: [ok(), ko('messaging/server-unavailable')],
      })
      .mockResolvedValueOnce({ successCount: 1, responses: [ok()] });

    await sendPushToUsers('u1', { title: 'T', body: 'B' });

    expect(mockSendEach).toHaveBeenCalledTimes(2);
    expect(mockSendEach.mock.calls[1][0].tokens).toEqual(['jeton-ios']);
    // Reçue au second essai : plus rien à signaler.
    expect(mockErreurs).toHaveLength(0);
  });

  test('un refus définitif n’est pas réessayé', async () => {
    // Clé APNs absente de Firebase : réessayer deux secondes plus tard ne
    // changera rien, et c'est la cause habituelle d'un iPhone muet.
    mockSendEach.mockResolvedValue({
      successCount: 1,
      responses: [ok(), ko('messaging/third-party-auth-error')],
    });

    await sendPushToUsers('u1', { title: 'T', body: 'B' });

    expect(mockSendEach).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mockErreurs)).toContain('third-party-auth-error');
  });

  test('le second essai n’efface pas du journal les refus définitifs', async () => {
    // Deux appareils refusés pour deux raisons : l'un passager, l'autre non.
    // Le second essai réussit sur le premier ; le refus définitif de l'autre
    // doit rester visible, sinon un iPhone muet n'apparaît plus nulle part.
    mockSendEach
      .mockResolvedValueOnce({
        successCount: 0,
        responses: [ko('messaging/third-party-auth-error'), ko('messaging/internal-error')],
      })
      .mockResolvedValueOnce({ successCount: 1, responses: [ok()] });

    await sendPushToUsers('u1', { title: 'T', body: 'B' });

    const journal = JSON.stringify(mockErreurs);
    expect(journal).toContain('third-party-auth-error');
    expect(journal).not.toContain('internal-error');
  });

  test('deux essais au plus, jamais trois', async () => {
    mockSendEach.mockResolvedValue({
      successCount: 0,
      responses: [ko('messaging/internal-error'), ko('messaging/internal-error')],
    });

    await sendPushToUsers('u1', { title: 'T', body: 'B' });

    expect(mockSendEach).toHaveBeenCalledTimes(2);
  });

  test('sans appareil enregistré, rien n’est envoyé', async () => {
    mockFindAll.mockResolvedValue([]);

    await sendPushToUsers('u1', { title: 'T', body: 'B' });

    expect(mockSendEach).not.toHaveBeenCalled();
  });

  test('une panne de l’appel lui-même ne fait pas tomber l’appelant', async () => {
    // Un échec d'envoi ne doit jamais annuler la commande déjà enregistrée.
    mockSendEach.mockRejectedValue(new Error('réseau'));

    await expect(sendPushToUsers('u1', { title: 'T', body: 'B' })).resolves.toBeUndefined();
  });
});
