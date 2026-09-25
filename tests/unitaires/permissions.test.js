const requirePermission = require('../../src/middlewares/requirePermission.middleware');
const { Permission } = require('../../src/models');

/**
 * Contrôle des permissions RBAC.
 *
 * C'était l'écart le plus grave de l'audit : le système existait en base et
 * le dashboard s'en servait pour composer sa navigation, mais rien ne le
 * vérifiait à l'arrivée. Ces tests décrivent le modèle strict — aucune
 * permission enregistrée = aucun accès.
 */

jest.mock('../../src/models', () => ({
  Permission: { findAll: jest.fn() },
  Menu: {},
}));
jest.mock('../../src/utils/logger', () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn() }));

function fausseReponse() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('requirePermission', () => {
  beforeEach(() => jest.clearAllMocks());

  test('refuse un appelant non authentifié', async () => {
    const res = fausseReponse();
    const suivant = jest.fn();
    await requirePermission('PRODUITS', 'view')({}, res, suivant);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(suivant).not.toHaveBeenCalled();
  });

  test('laisse passer un SuperAdmin sans consulter la table', async () => {
    const res = fausseReponse();
    const suivant = jest.fn();
    await requirePermission('PRODUITS', 'delete')(
      { user: { id: '1', role: 'SuperAdmin' } }, res, suivant
    );

    expect(suivant).toHaveBeenCalled();
    expect(Permission.findAll).not.toHaveBeenCalled();
  });

  test('refuse quand aucune permission n\'est enregistrée', async () => {
    // Le cœur du modèle strict : l'absence de ligne vaut refus, pas accès.
    Permission.findAll.mockResolvedValue([]);
    const res = fausseReponse();
    const suivant = jest.fn();

    await requirePermission('PRODUITS', 'view')(
      { user: { id: '1', role: 'Admin' }, originalUrl: '/admin/liste-produits' }, res, suivant
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(suivant).not.toHaveBeenCalled();
  });

  test('laisse passer quand le droit demandé est accordé', async () => {
    Permission.findAll.mockResolvedValue([{ canView: true, canDelete: false }]);
    const res = fausseReponse();
    const suivant = jest.fn();

    await requirePermission('PRODUITS', 'view')(
      { user: { id: '1', role: 'Admin' } }, res, suivant
    );

    expect(suivant).toHaveBeenCalled();
  });

  test('refuse une action non accordée même si la lecture l\'est', async () => {
    // Cas réel : un modérateur peut consulter les produits sans pouvoir les
    // supprimer. Un contrôle uniquement sur `canView` laisserait passer.
    Permission.findAll.mockResolvedValue([{ canView: true, canDelete: false }]);
    const res = fausseReponse();
    const suivant = jest.fn();

    await requirePermission('PRODUITS', 'delete')(
      { user: { id: '1', role: 'Admin' }, originalUrl: '/admin/produit/42' }, res, suivant
    );

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('accepte une liste de menus dont un seul suffit', async () => {
    Permission.findAll.mockResolvedValue([{ canUpdate: true }]);
    const res = fausseReponse();
    const suivant = jest.fn();

    await requirePermission(['PRODUITS', 'MODERATION'], 'update')(
      { user: { id: '1', role: 'Admin' } }, res, suivant
    );

    expect(suivant).toHaveBeenCalled();
  });

  test('refuse en cas de panne de la vérification', async () => {
    // Laisser passer « parce que la base ne répond pas » transformerait une
    // panne en porte ouverte.
    Permission.findAll.mockRejectedValue(new Error('connexion perdue'));
    const res = fausseReponse();
    const suivant = jest.fn();

    await requirePermission('PRODUITS', 'view')(
      { user: { id: '1', role: 'Admin' }, originalUrl: '/admin/x' }, res, suivant
    );

    expect(res.status).toHaveBeenCalledWith(503);
    expect(suivant).not.toHaveBeenCalled();
  });

  test('rejette une action inconnue au montage des routes', () => {
    // Erreur de programmation : elle doit éclater au démarrage, pas à la
    // première requête en production.
    expect(() => requirePermission('PRODUITS', 'ecrire')).toThrow(/Action inconnue/);
  });
});
