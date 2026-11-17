/**
 * Une visite de boutique se compte une fois par personne et par jour, sans
 * le vendeur ni les robots ; une vue de produit se compte une fois.
 *
 * Avant : « Visites » valait 0 sur le tableau de bord (la somme des vues des
 * produits) et 9 sur Ma boutique (chaque chargement de la page d'accueil du
 * site, rafraîchissements et vendeur compris), pour la même boutique.
 */

const mockQuery = jest.fn();
const mockIncrementBoutique = jest.fn().mockResolvedValue();
const mockIncrementProduit = jest.fn().mockResolvedValue();

jest.mock('../../src/config/db', () => ({
  query: (...a) => mockQuery(...a),
  QueryTypes: { SELECT: 'SELECT' },
  define: jest.fn(() => ({})),
}));
jest.mock('../../src/models', () => ({
  Boutique: { increment: (...a) => mockIncrementBoutique(...a) },
  Produit: { increment: (...a) => mockIncrementProduit(...a) },
}));
jest.mock('../../src/models/visiteBoutique.model', () => ({}));
jest.mock('../../src/utils/logger', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }));

const VisiteService = require('../../src/services/visites/visite.service');

const CHROME = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36';
const APPLI = 'Dart/3.9 (dart:io)';
const MIDI = new Date('2026-11-17T12:00:00Z');

beforeEach(() => {
  mockQuery.mockReset();
  mockIncrementBoutique.mockClear();
  mockIncrementProduit.mockClear();
});

describe('Qui compte', () => {
  it.each([
    ['WhatsApp/2.24.1 A', true],
    ['facebookexternalhit/1.1', true],
    ['Googlebot/2.1', true],
    ['curl/8.4.0', true],
    ['', true],
    [undefined, true],
    [CHROME, false],
    [APPLI, false],
  ])('« %s » est un robot : %s', (ua, robot) => {
    expect(VisiteService.estUnRobot(ua)).toBe(robot);
  });

  it('l’identifiant d’appareil doit être hexadécimal', () => {
    expect(VisiteService.identifiantAppareil('A1B2C3D4E5F60718A1B2C3D4E5F60718')).toBe('a1b2c3d4e5f60718a1b2c3d4e5f60718');
    expect(VisiteService.identifiantAppareil('pas-un-identifiant')).toBeNull();
    expect(VisiteService.identifiantAppareil(undefined)).toBeNull();
  });
});

describe('L’empreinte du visiteur', () => {
  const base = { boutiqueId: 'b1', ip: '41.82.10.5', userAgent: CHROME };

  it('ne garde ni l’adresse ni l’identifiant en clair', () => {
    const e = VisiteService.empreinte({ ...base, utilisateurId: 'u-42' });
    expect(e).toMatch(/^[0-9a-f]{64}$/);
    expect(e).not.toContain('41.82');
    expect(e).not.toContain('u-42');
  });

  it('le compte prime sur l’appareil, l’appareil sur l’adresse', () => {
    const compte = VisiteService.empreinte({ ...base, utilisateurId: 'u-42', appareil: 'abcd' });
    expect(compte).toBe(VisiteService.empreinte({ boutiqueId: 'b1', utilisateurId: 'u-42' }));
    const appareil = VisiteService.empreinte({ ...base, appareil: 'abcd' });
    expect(appareil).toBe(VisiteService.empreinte({ boutiqueId: 'b1', appareil: 'abcd', ip: 'autre' }));
    expect(appareil).not.toBe(VisiteService.empreinte(base));
  });

  it('change d’une boutique à l’autre', () => {
    expect(VisiteService.empreinte(base)).not.toBe(VisiteService.empreinte({ ...base, boutiqueId: 'b2' }));
  });
});

describe('Une visite de boutique', () => {
  const visite = {
    boutiqueId: 'b1',
    vendeurId: 'v1',
    canal: 'site',
    ip: '41.82.10.5',
    userAgent: CHROME,
    maintenant: MIDI,
  };

  it('nouvelle dans la journée : enregistrée, et le total avance', async () => {
    mockQuery.mockResolvedValue([[{ id: 1 }], 1]);
    await expect(VisiteService.enregistrer(visite)).resolves.toBe(true);

    const [sql, options] = mockQuery.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (boutique_id, jour, visiteur) DO NOTHING');
    expect(options.replacements).toMatchObject({ boutiqueId: 'b1', jour: '2026-11-17', canal: 'site' });
    expect(mockIncrementBoutique).toHaveBeenCalledWith('vitrineVues', { where: { id: 'b1' } });
  });

  it('déjà venue aujourd’hui : rien ne bouge', async () => {
    mockQuery.mockResolvedValue([[], 0]);
    await expect(VisiteService.enregistrer(visite)).resolves.toBe(false);
    expect(mockIncrementBoutique).not.toHaveBeenCalled();
  });

  it('le vendeur chez lui ne compte pas', async () => {
    await expect(
      VisiteService.enregistrer({ ...visite, canal: 'app', utilisateurId: 'v1', userAgent: APPLI }),
    ).resolves.toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('un robot ne compte pas', async () => {
    await expect(VisiteService.enregistrer({ ...visite, userAgent: 'WhatsApp/2.24' })).resolves.toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('une panne de base ne casse rien', async () => {
    mockQuery.mockRejectedValue(new Error('base indisponible'));
    await expect(VisiteService.enregistrer(visite)).resolves.toBe(false);
  });

  it('un canal inconnu est ramené à « site »', async () => {
    mockQuery.mockResolvedValue([[{ id: 2 }], 1]);
    await VisiteService.enregistrer({ ...visite, canal: 'autre' });
    expect(mockQuery.mock.calls[0][1].replacements.canal).toBe('site');
  });
});

describe('Les visites récentes', () => {
  it('aujourd’hui, 7 jours et 30 jours, jour courant compris', async () => {
    mockQuery.mockResolvedValue([{ aujourdhui: '2', sept: '5', trente: '11' }]);
    await expect(VisiteService.recentes('b1', MIDI)).resolves.toEqual({
      aujourdHui: 2,
      septJours: 5,
      trenteJours: 11,
    });
    const { replacements } = mockQuery.mock.calls[0][1];
    expect(replacements).toMatchObject({ aujourdhui: '2026-11-17', sept: '2026-11-11', trente: '2026-10-19' });
  });

  it('indisponibles : des zéros, pas une erreur', async () => {
    mockQuery.mockRejectedValue(new Error('table absente'));
    await expect(VisiteService.recentes('b1', MIDI)).resolves.toEqual({
      aujourdHui: 0,
      septJours: 0,
      trenteJours: 0,
    });
  });
});

describe('Une vue de produit', () => {
  it('comptée une fois', async () => {
    await expect(
      VisiteService.compterVueProduit({ produitId: 'p1', vendeurId: 'v1', utilisateurId: 'u1', userAgent: APPLI }),
    ).resolves.toBe(true);
    expect(mockIncrementProduit).toHaveBeenCalledWith('vues', { where: { id: 'p1' } });
  });

  it('pas par son vendeur, ni par un robot', async () => {
    await VisiteService.compterVueProduit({ produitId: 'p1', vendeurId: 'v1', utilisateurId: 'v1', userAgent: APPLI });
    await VisiteService.compterVueProduit({ produitId: 'p1', userAgent: 'Googlebot/2.1' });
    expect(mockIncrementProduit).not.toHaveBeenCalled();
  });
});
