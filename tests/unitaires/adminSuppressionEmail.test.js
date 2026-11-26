/**
 * Un administrateur supprimé libère son adresse e-mail : on peut recréer un
 * administrateur avec le même e-mail. Y compris pour un compte supprimé
 * AVANT ce correctif, dont l'adresse est libérée à la recréation.
 */

const mockFindOne = jest.fn();
const mockCount = jest.fn();
const mockCreate = jest.fn();

jest.mock('../../src/models', () => ({
  Utilisateur: {
    findOne: (...a) => mockFindOne(...a),
    count: (...a) => mockCount(...a),
    create: (...a) => mockCreate(...a),
  },
  Menu: {},
  Permission: { bulkCreate: jest.fn() },
  sequelize: {
    transaction: jest.fn(async (fn) => (typeof fn === 'function'
      ? fn('t')
      : { commit: jest.fn(), rollback: jest.fn() })),
  },
}));
jest.mock('../../src/services/resend.service', () => ({ sendNewAdminEmail: jest.fn().mockResolvedValue({}) }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const Service = require('../../src/services/admin.management.service');

const compte = (surcharges = {}) => {
  const c = {
    id: '3f6c1c2e-0000-4000-8000-000000000000', email: 'fatou@kodafrik.com', telephone: '+221771234567', role: 'Admin',
    isSoftDeleted: () => false, ...surcharges,
  };
  c.update = jest.fn(async (v) => Object.assign(c, v));
  c.destroy = jest.fn(async () => {});
  return c;
};

beforeEach(() => { mockFindOne.mockReset(); mockCount.mockReset(); mockCreate.mockReset(); });

test('l’adresse libérée reste une adresse valide et garde la trace de l’originale', () => {
  expect(Service.adresseLiberee(compte())).toBe('supprime.3f6c1c2e.fatou@kodafrik.com');
});

test('supprimer un admin libère son e-mail et son téléphone, puis le supprime', async () => {
  const c = compte();
  mockFindOne.mockResolvedValue(c);
  mockCount.mockResolvedValue(2);
  await Service.supprimerAdmin(c.id, { demandeurId: 'autre' });
  expect(c.update).toHaveBeenCalledWith(
    { email: 'supprime.3f6c1c2e.fatou@kodafrik.com', telephone: null },
    expect.objectContaining({ transaction: 't' }),
  );
  expect(c.destroy).toHaveBeenCalledWith({ transaction: 't' });
});

test('recréer un admin avec l’e-mail d’un compte supprimé AVANT le correctif : l’adresse est libérée', async () => {
  const ancien = compte({ isSoftDeleted: () => true });
  mockFindOne.mockResolvedValue(ancien);
  mockCreate.mockResolvedValue({ id: 'nouveau', email: 'fatou@kodafrik.com' });
  await Service.creerAdmin({ nom: 'Diop', prenom: 'Fatou', email: 'Fatou@Kodafrik.com' });
  expect(ancien.update).toHaveBeenCalledWith({ email: 'supprime.3f6c1c2e.fatou@kodafrik.com', telephone: null }, expect.any(Object));
  expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ email: 'fatou@kodafrik.com' }), expect.any(Object));
});

test('un compte actif avec cet e-mail : 409, rien de créé', async () => {
  mockFindOne.mockResolvedValue(compte());
  await expect(Service.creerAdmin({ nom: 'Diop', prenom: 'Fatou', email: 'fatou@kodafrik.com' })).rejects.toMatchObject({ status: 409 });
  expect(mockCreate).not.toHaveBeenCalled();
});
