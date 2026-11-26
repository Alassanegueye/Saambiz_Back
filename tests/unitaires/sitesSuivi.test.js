/**
 * La fréquentation des sites vitrines (kodafrik.com, saambiz.com).
 *
 * Le PHP du site Kodafrik ne s'exécute plus chez LWS : ses pages vues
 * arrivent ici. Ce qui compte : rien d'identifiant n'est gardé (IP tronquée,
 * empreinte du jour), les robots et les envois malformés sont écartés sans
 * bruit, et un compteur ne fait jamais échouer une page.
 */

const mockQuery = jest.fn();

jest.mock('../../src/config/db', () => ({
  query: (...a) => mockQuery(...a),
  QueryTypes: { SELECT: 'SELECT' },
  define: jest.fn(() => ({})),
}));
jest.mock('../../src/models', () => ({ Boutique: {}, Produit: {} }));
jest.mock('../../src/models/visiteBoutique.model', () => ({}));
jest.mock('../../src/utils/logger', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }));

const SuiviService = require('../../src/services/sites/suivi.service');
const { ipAnonyme, lireSource, lireAgent, lirePays, estApplication } = require('../../src/services/sites/visiteur');

const CHROME = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36';
const MIDI = new Date('2026-11-26T12:00:00Z');
const contexte = { ip: '41.82.10.55', userAgent: CHROME, maintenant: MIDI };

/** La base : un sel pour le jour, et l'insertion. */
function baseNormale() {
  mockQuery.mockImplementation(async (sql) => {
    if (/SELECT valeur FROM site_sel/.test(sql)) return [{ valeur: 'a'.repeat(32) }];
    return [[], 1];
  });
}

const insertion = () => mockQuery.mock.calls.find(([sql]) => /INSERT INTO site_evenement/.test(sql));

beforeEach(() => {
  mockQuery.mockReset();
  baseNormale();
});

describe('Ce qui est gardé', () => {
  it('une page vue : le chemin, la source lisible, l’appareil, l’IP sans son dernier octet', async () => {
    const ok = await SuiviService.enregistrer('kodafrik', {
      s: 'visite1234abcd', t: 'page', c: '/realisations/signs', ti: 'Signs', e: 1,
      r: 'https://www.google.com/search?q=kodafrik', l: 'fr-SN', sc: '390x844', f: 'Africa/Dakar',
    }, contexte);
    expect(ok).toBe(true);
    const [, { replacements: r }] = insertion();
    expect(r).toMatchObject({
      site: 'kodafrik', jour: '2026-11-26', type: 'page', visite: 'visite1234abcd',
      chemin: '/realisations/signs', titre: 'Signs', entree: true, source: 'Google',
      appareil: 'Mobile', navigateur: 'Chrome', os: 'Android', ecran: '390x844',
      langue: 'fr-SN', pays: 'SN', ipAnonyme: '41.82.10.0',
    });
    expect(r.visiteur).toMatch(/^[0-9a-f]{20}$/);
    expect(JSON.stringify(r)).not.toContain('41.82.10.55');
  });

  it('accepte le corps en texte brut (navigator.sendBeacon)', async () => {
    const ok = await SuiviService.enregistrer('kodafrik', JSON.stringify({ s: 'visite1234abcd', t: 'clic', c: '/', ci: 'whatsapp' }), contexte);
    expect(ok).toBe(true);
    expect(insertion()[1].replacements).toMatchObject({ type: 'clic', cible: 'whatsapp' });
  });

  it('borne le temps passé entre 0 et 6 heures', async () => {
    await SuiviService.enregistrer('kodafrik', { s: 'visite1234abcd', t: 'duree', c: '/', v: 99999999999 }, contexte);
    expect(insertion()[1].replacements.valeur).toBe(6 * 3600 * 1000);
    mockQuery.mockClear();
    await SuiviService.enregistrer('kodafrik', { s: 'visite1234abcd', t: 'duree', c: '/', v: -5 }, contexte);
    expect(insertion()[1].replacements.valeur).toBe(0);
  });

  it('le même visiteur garde la même empreinte dans la journée, pas d’un jour à l’autre', () => {
    const a = SuiviService.empreinte('sel-du-jour', '41.82.10.55', CHROME);
    expect(SuiviService.empreinte('sel-du-jour', '41.82.10.55', CHROME)).toBe(a);
    expect(SuiviService.empreinte('sel-du-lendemain', '41.82.10.55', CHROME)).not.toBe(a);
    expect(SuiviService.empreinte('sel-du-jour', '41.82.10.56', CHROME)).not.toBe(a);
  });
});

describe('Ce qui est écarté, sans bruit', () => {
  it.each([
    ['un site inconnu', 'inconnu', { s: 'visite1234abcd', t: 'page', c: '/' }, CHROME],
    ['un robot', 'kodafrik', { s: 'visite1234abcd', t: 'page', c: '/' }, 'Googlebot/2.1'],
    ['un agent absent', 'kodafrik', { s: 'visite1234abcd', t: 'page', c: '/' }, ''],
    ['un type inconnu', 'kodafrik', { s: 'visite1234abcd', t: 'achat', c: '/' }, CHROME],
    ['un numéro de visite invalide', 'kodafrik', { s: 'x', t: 'page', c: '/' }, CHROME],
    ['un corps illisible', 'kodafrik', '{pas du json', CHROME],
  ])('%s', async (_cas, site, corps, ua) => {
    expect(await SuiviService.enregistrer(site, corps, { ...contexte, userAgent: ua })).toBe(false);
    expect(insertion()).toBeUndefined();
  });

  it('un chemin qui n’est pas une page du site n’est pas gardé', async () => {
    await SuiviService.enregistrer('kodafrik', { s: 'visite1234abcd', t: 'page', c: 'https://ailleurs.com' }, contexte);
    expect(insertion()[1].replacements.chemin).toBeNull();
  });

  it('une panne de base ne remonte jamais', async () => {
    mockQuery.mockRejectedValue(new Error('base indisponible'));
    await expect(SuiviService.enregistrer('kodafrik', { s: 'visite1234abcd', t: 'page', c: '/' }, contexte)).resolves.toBe(false);
  });
});

describe('Le visiteur, sans le pister', () => {
  it('tronque les adresses', () => {
    expect(ipAnonyme('41.82.10.55')).toBe('41.82.10.0');
    expect(ipAnonyme('::ffff:41.82.10.55')).toBe('41.82.10.0');
    expect(ipAnonyme('2001:db8:85a3::8a2e:370:7334')).toBe('2001:db8:85a3::');
    expect(ipAnonyme('pas une adresse')).toBeNull();
  });

  it('nomme la source plutôt que de garder une adresse', () => {
    expect(lireSource('https://l.facebook.com/l.php?u=x')).toBe('Facebook');
    expect(lireSource('https://www.linkedin.com/feed')).toBe('LinkedIn');
    expect(lireSource('https://kodafrik.com/contact', null, 'kodafrik.com')).toBe('Accès direct');
    expect(lireSource(null)).toBe('Accès direct');
    expect(lireSource('https://x.com/a', 'newsletter')).toBe('newsletter');
    expect(lireSource('https://annuaire.sn/fiche')).toBe('annuaire.sn');
  });

  it('lit l’appareil, le pays, et reconnaît l’application', () => {
    expect(lireAgent('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari/604.1')).toEqual({ appareil: 'Tablette', navigateur: 'Safari', os: 'iOS' });
    expect(lireAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126 Safari/537.36 Edg/126')).toEqual({ appareil: 'Ordinateur', navigateur: 'Edge', os: 'Windows' });
    expect(lirePays('fr-SN')).toBe('SN');
    expect(lirePays('fr', { 'cf-ipcountry': 'ci' })).toBe('CI');
    expect(lirePays('fr')).toBeNull();
    expect(estApplication('Dart/3.9 (dart:io)')).toBe(true);
    expect(estApplication(CHROME)).toBe(false);
  });
});
