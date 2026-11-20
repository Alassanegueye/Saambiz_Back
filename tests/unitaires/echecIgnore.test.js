/**
 * `echecIgnore` remplace les `.catch(() => {})` des actions lancées sans être
 * attendues (notification, e-mail, journal d'audit).
 *
 * Ce qui compte :
 *  - l'échec laisse un avertissement qui nomme l'action ;
 *  - la promesse se résout quand même, avec la valeur de repli demandée ;
 *  - même si le journal lui-même tombe en panne, la promesse ne rejette pas :
 *    un rejet que personne n'attend arrête le serveur (`unhandledRejection`).
 */
const mockWarn = jest.fn();
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: (...a) => mockWarn(...a),
  error: jest.fn(),
}));

const echecIgnore = require('../../src/utils/echecIgnore');

beforeEach(() => mockWarn.mockReset());

test('l’échec est journalisé avec le nom de l’action, et la promesse se résout', async () => {
  const resultat = await Promise.reject(new Error('SMTP indisponible'))
    .catch(echecIgnore('e-mail de bienvenue'));

  expect(resultat).toBeUndefined();
  expect(mockWarn).toHaveBeenCalledWith('[échec ignoré] e-mail de bienvenue', { message: 'SMTP indisponible' });
});

test('la valeur de repli remplace le résultat', async () => {
  await expect(Promise.reject(new Error('x')).catch(echecIgnore('boutique', null))).resolves.toBeNull();
  await expect(Promise.reject(new Error('x')).catch(echecIgnore('produits', []))).resolves.toEqual([]);
});

test('un rejet qui n’est pas une Error est journalisé tel quel', async () => {
  await Promise.reject('délai dépassé').catch(echecIgnore('push FCM'));
  expect(mockWarn).toHaveBeenCalledWith('[échec ignoré] push FCM', { message: 'délai dépassé' });
});

test('un journal en panne ne transforme pas l’échec ignoré en rejet', async () => {
  mockWarn.mockImplementation(() => { throw new Error('journal en panne'); });

  await expect(Promise.reject(new Error('x')).catch(echecIgnore('audit', 'repli'))).resolves.toBe('repli');
});

test('sans échec, rien n’est journalisé', async () => {
  await expect(Promise.resolve(42).catch(echecIgnore('notification'))).resolves.toBe(42);
  expect(mockWarn).not.toHaveBeenCalled();
});
