/**
 * La lecture de la fréquentation : même contrat que l'ancienne API PHP du
 * site Kodafrik (statistiques.php, visites.php), pour que le dashboard lise
 * la même chose qu'avant — des nombres, jamais les chaînes que PostgreSQL
 * renvoie pour un COUNT.
 */

const mockQuery = jest.fn();
jest.mock('../../src/config/db', () => ({
  query: (...a) => mockQuery(...a),
  QueryTypes: { SELECT: 'SELECT' },
  define: jest.fn(() => ({})),
}));

const Stats = require('../../src/services/sites/statistiques.service');

const MAINTENANT = new Date('2026-11-26T15:00:00Z');

beforeEach(() => mockQuery.mockReset());

describe('La période', () => {
  it.each([
    ['jour', '2026-11-26T00:00:00.000Z'],
    ['7', '2026-11-20T00:00:00.000Z'],
    ['30', '2026-10-28T00:00:00.000Z'],
    ['90', '2026-08-29T00:00:00.000Z'],
    ['n’importe quoi', '2026-11-20T00:00:00.000Z'],
  ])('« %s » commence le %s', (periode, debut) => {
    expect(Stats.debutPeriode(periode, MAINTENANT).toISOString()).toBe(debut);
  });
});

describe('Les chiffres', () => {
  it('rend le contrat du dashboard, en nombres', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/COUNT\(\*\) AS n FROM site_evenement WHERE site = :site AND type = 'page'/.test(sql)) return [{ n: '40' }];
      if (/AS rebonds/.test(sql)) return [{ visites: '10', rebonds: '4', duree_moyenne: '61234.5' }];
      if (/COUNT\(DISTINCT \(visiteur, jour\)\)/.test(sql)) return [{ n: '8' }];
      if (/cree_le >= :depuis/.test(sql)) return [{ n: '2' }];
      if (/FROM site_message/.test(sql)) return [{ n: '3' }];
      if (/AS cle/.test(sql)) return [{ cle: '2026-11-25', pages: '12', visites: '4', visiteurs: '3' }];
      if (/'\/realisations\/%'/.test(sql)) return [{ chemin: '/realisations/signs', titre: 'Signs', vues: '7', visites: '5' }];
      if (/'\/blog\/%'/.test(sql)) return [];
      if (/type = 'page' AND cree_le >= :du\s+GROUP BY chemin/.test(sql)) return [{ chemin: '/', titre: 'Accueil', vues: '20', visites: '9' }];
      if (/type = 'clic'/.test(sql)) return [{ nom: 'whatsapp', nombre: '5' }];
      if (/COALESCE\(o\.source/.test(sql)) return [{ nom: 'Google', visites: '6' }];
      return [];
    });
    const r = await Stats.statistiques('kodafrik', '7', MAINTENANT);
    expect(r.periode).toBe('7');
    expect(r.du).toBe('2026-11-20T00:00:00Z');
    expect(r.chiffres).toEqual({
      pages_vues: 40, visites: 10, visiteurs: 8, duree_moyenne_ms: 61235, taux_rebond: 40,
      pages_par_visite: 4, en_ligne: 2, messages: 3, vues_realisations: 7,
    });
    expect(r.serie).toEqual({ par: 'jour', points: [{ cle: '2026-11-25', pages: 12, visites: 4, visiteurs: 3 }] });
    expect(r.pages).toEqual([{ chemin: '/', titre: 'Accueil', vues: 20, visites: 9 }]);
    expect(r.clics).toEqual([{ nom: 'whatsapp', nombre: 5 }]);
    expect(r.sources).toEqual([{ nom: 'Google', visites: 6 }]);
    for (const cle of ['appareils', 'navigateurs', 'systemes', 'pays', 'langues', 'ecrans', 'arrivees', 'articles']) {
      expect(Array.isArray(r[cle])).toBe(true);
    }
    // Toujours filtré par site.
    for (const [, options] of mockQuery.mock.calls) expect(options.replacements.site).toBe('kodafrik');
  });

  it('sans visite, ni taux de rebond ni pages par visite', async () => {
    mockQuery.mockResolvedValue([]);
    const r = await Stats.statistiques('kodafrik', 'jour', MAINTENANT);
    expect(r.serie.par).toBe('heure');
    expect(r.chiffres.taux_rebond).toBeNull();
    expect(r.chiffres.pages_par_visite).toBeNull();
    expect(r.chiffres.visites).toBe(0);
  });
});

describe('Les visites une à une', () => {
  it('pagine, joint le parcours, et ne renvoie pas le numéro de visite', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/SELECT COUNT\(\*\) AS n FROM liste/.test(sql)) return [{ n: '45' }];
      if (/SELECT \* FROM liste/.test(sql)) {
        return [{ visite: 'v1', debut: '2026-11-26T14:50:00Z', fin: '2026-11-26T14:58:00Z', pages: '3', duree_ms: '120000', messages: '1', source: 'Google' }];
      }
      if (/ROW_NUMBER\(\)/.test(sql)) return [{ visite: 'v1', date: '2026-11-26T14:50:00Z', type: 'page', chemin: '/', titre: 'Accueil', cible: null }];
      if (/GROUP BY 1 ORDER BY n DESC/.test(sql)) return [{ nom: 'Google', n: '45' }];
      return [];
    });
    const r = await Stats.visites('kodafrik', { periode: '30', page: '2', par: '20', q: '50%_off', ecrit: '1' }, MAINTENANT);
    expect(r).toMatchObject({ total: 45, page: 2, pages: 3, par: 20 });
    expect(r.visites[0]).toMatchObject({ pages: 3, duree_ms: 120000, messages: 1, en_ligne: true });
    expect(r.visites[0].visite).toBeUndefined();
    expect(r.visites[0].parcours).toHaveLength(1);
    expect(r.filtres.sources).toEqual([{ nom: 'Google', visites: 45 }]);
    // Les jokers de la recherche sont pris à la lettre.
    const avecRecherche = mockQuery.mock.calls.find(([, o]) => o.replacements.q);
    expect(avecRecherche[1].replacements.q).toBe('%50\\%\\_off%');
    expect(avecRecherche[0]).toContain('messages > 0');
  });
});
