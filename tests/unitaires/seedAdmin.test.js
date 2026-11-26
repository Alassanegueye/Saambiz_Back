/**
 * Le seed de l'administrateur ne doit jamais empêcher l'API de démarrer.
 *
 * Le 26/11/2026, le compte ADMIN_EMAIL a été supprimé depuis l'administration
 * (suppression logique) : le seed, qui cherchait sans les supprimés, l'a cru
 * absent, a voulu le recréer, la base a refusé l'adresse déjà prise
 * (« Validation error »), et le conteneur a redémarré en boucle.
 */

const mockTrouver = jest.fn();
const mockCreer = jest.fn();
const mockMenus = jest.fn();
const mockPermission = jest.fn();

jest.mock('../../src/models/utilisateur.model', () => ({
  findOne: (...a) => mockTrouver(...a),
  create: (...a) => mockCreer(...a),
}));
jest.mock('../../src/models/configApp.model', () => ({ findOne: jest.fn().mockResolvedValue({ cle: 'prix_abonnement' }) }));
jest.mock('../../src/models', () => ({
  Menu: { findAll: (...a) => mockMenus(...a) },
  Permission: { findOrCreate: (...a) => mockPermission(...a) },
}));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const seedAdmin = require('../../src/seed/seedAdmin');

beforeEach(() => {
  [mockTrouver, mockCreer, mockMenus, mockPermission].forEach((m) => m.mockReset());
  process.env.ADMIN_EMAIL = 'Admin@SaamBiz.com';
  process.env.ADMIN_PASSWORD = 'motdepasse-de-test-assez-long';
  mockMenus.mockResolvedValue([{ id: 'm1' }]);
  mockPermission.mockResolvedValue([{ update: jest.fn() }, true]);
});

test('compte supprimé depuis l’administration : ni recréé, ni bloquant', async () => {
  mockTrouver.mockResolvedValue({ id: 'a1', isSoftDeleted: () => true });
  await expect(seedAdmin()).resolves.toBeUndefined();
  expect(mockCreer).not.toHaveBeenCalled();
  expect(mockPermission).not.toHaveBeenCalled();
  // Recherche parmi les supprimés aussi.
  expect(mockTrouver.mock.calls[0][0].paranoid).toBe(false);
});

test('compte existant : permissions accordées, rien de créé', async () => {
  mockTrouver.mockResolvedValue({ id: 'a1', isSoftDeleted: () => false });
  await seedAdmin();
  expect(mockCreer).not.toHaveBeenCalled();
  expect(mockPermission).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'a1', menuId: 'm1' } }));
});

test('aucun compte : il est créé', async () => {
  mockTrouver.mockResolvedValue(null);
  mockCreer.mockResolvedValue({ id: 'a2' });
  await seedAdmin();
  expect(mockCreer).toHaveBeenCalledWith(expect.objectContaining({ email: 'Admin@SaamBiz.com', role: 'Admin' }));
});

test('admin supprimé dont l’adresse a été libérée (supprime.<id>.<adresse>) : pas recréé non plus', async () => {
  mockTrouver
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ id: 'a1', email: 'supprime.a1b2c3d4.admin@saambiz.com', isSoftDeleted: () => true });
  await seedAdmin();
  expect(mockCreer).not.toHaveBeenCalled();
});
