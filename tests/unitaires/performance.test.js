/**
 * Optimisations de performance — on vérifie qu'elles ne changent pas le
 * comportement, et qu'elles font bien l'économie annoncée.
 *
 * Les modèles sont simulés : aucun PostgreSQL n'est nécessaire.
 */

jest.mock('../../src/models', () => ({
  ConfigApp: {
    findOne: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
  },
}));

const { ConfigApp } = require('../../src/models');
const ConfigService = require('../../src/services/config/config.service');
const { NotFoundError, ConflictError } = require('../../src/errors/AppError');
const { estImageMatricielle } = require('../../src/services/stockage/upload.service');

describe('ConfigService — cache des réglages', () => {
  beforeEach(() => {
    ConfigService._viderCache();
    jest.clearAllMocks();
  });

  it('ne lit la base qu\'une fois pour deux lectures rapprochées', async () => {
    ConfigApp.findOne.mockResolvedValue({ cle: 'prix_abonnement', valeur: '3500' });

    expect(await ConfigService.getPrixAbonnement()).toBe(3500);
    expect(await ConfigService.getPrixAbonnement()).toBe(3500);
    expect(ConfigApp.findOne).toHaveBeenCalledTimes(1);
  });

  it('met aussi en cache l\'absence d\'une clé', async () => {
    ConfigApp.findOne.mockResolvedValue(null);

    await ConfigService.getConfig('maintenance');
    await ConfigService.getConfig('maintenance');
    expect(ConfigApp.findOne).toHaveBeenCalledTimes(1);
  });

  it('relit la base après une modification', async () => {
    const enBase = { cle: 'prix_abonnement', valeur: '2000', description: null, update: jest.fn() };
    ConfigApp.findOne.mockResolvedValue(enBase);
    await ConfigService.getPrixAbonnement();

    enBase.update.mockImplementation(async ({ valeur }) => { enBase.valeur = valeur; });
    await ConfigService.modifierConfig({ cle: 'prix_abonnement', valeur: '5000', adminId: 'a' });

    expect(await ConfigService.getPrixAbonnement()).toBe(5000);
  });

  it('renvoie des valeurs par défaut pour l\'application mobile', async () => {
    ConfigApp.findOne.mockResolvedValue(null);
    expect(await ConfigService.getConfigApplicationMobile()).toEqual({
      minVersionAndroid: '1.0.0',
      minVersionIos: '1.0.0',
      maintenance: false,
      message: null,
    });
  });

  it('lève des erreurs typées (404 / 409) et non des Error génériques', async () => {
    ConfigApp.findOne.mockResolvedValue(null);
    await expect(ConfigService.modifierConfig({ cle: 'x', valeur: '1' }))
      .rejects.toBeInstanceOf(NotFoundError);

    ConfigApp.findOne.mockResolvedValue({ cle: 'x' });
    await expect(ConfigService.ajouterConfig({ cle: 'x', valeur: '1' }))
      .rejects.toBeInstanceOf(ConflictError);
  });
});

describe('upload.service — détection des images à réduire', () => {
  it('reconnaît PNG et JPEG', () => {
    expect(estImageMatricielle(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D]))).toBe(true);
    expect(estImageMatricielle(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]))).toBe(true);
  });

  it('laisse un PDF intact', () => {
    expect(estImageMatricielle(Buffer.from('%PDF-1.7'))).toBe(false);
  });
});
