/**
 * La page « Site vitrine » de l'administration SaamBiz : les visites des
 * boutiques et ce que font les vendeurs — connexions, sessions, produits,
 * commandes, promotions, messages (jamais leur contenu).
 */

const mockQuery = jest.fn();
jest.mock('../../src/config/db', () => ({
  query: (...a) => mockQuery(...a),
  QueryTypes: { SELECT: 'SELECT' },
  define: jest.fn(() => ({})),
}));

const Vendeurs = require('../../src/services/sites/vendeurs.service');
const Connexions = require('../../src/services/sites/connexions.service');

jest.mock('../../src/utils/logger', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }));

const MAINTENANT = new Date('2026-11-26T15:00:00Z');
const ID = '3f6c1c2e-0000-4000-8000-000000000000';

beforeEach(() => mockQuery.mockReset());

describe('Les visites des boutiques', () => {
  it('totalise le site et l’application, en nombres', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/COUNT\(DISTINCT boutique_id\)/.test(sql)) return [{ visites: '30', site: '18', app: '12', boutiques: '7' }];
      if (/AS cle/.test(sql)) return [{ cle: '2026-11-26', site: '3', app: '2' }];
      if (/JOIN boutique b/.test(sql)) return [{ id: 'b1', nom: 'Chez Awa', slug: 'chez-awa', vitrine_active: true, visites: '9', site: '6', app: '3' }];
      if (/role = 'Vendeur'/.test(sql)) return [{ inscrits: '114', nouveaux: '4', actifs: '57' }];
      return [];
    });
    const r = await Vendeurs.boutiques('7', MAINTENANT);
    expect(r.chiffres).toEqual({
      visites: 30, visites_site: 18, visites_app: 12, boutiques_visitees: 7,
      vendeurs_inscrits: 114, vendeurs_actifs: 57, nouveaux_vendeurs: 4,
    });
    expect(r.serie.points).toEqual([{ cle: '2026-11-26', site: 3, app: 2 }]);
    expect(r.boutiques[0]).toEqual({ id: 'b1', nom: 'Chez Awa', slug: 'chez-awa', vitrine_active: true, visites: 9, site: 6, app: 3 });
  });
});

describe('Les vendeurs authentifiés', () => {
  it('liste ceux venus sur la période, avec leur appareil et leur activité', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/SELECT COUNT\(\*\) AS n FROM liste/.test(sql)) return [{ n: '1' }];
      if (/SELECT \* FROM liste/.test(sql)) {
        return [{ id: ID, nom: 'Ndiaye', prenom: 'Awa', boutique: 'Chez Awa', agent: 'Dart/3.9 (dart:io)', jours_actifs: '5', vitrine_active: 1 }];
      }
      if (/FROM produit/.test(sql)) return [{ id: ID, n: '3' }];
      if (/FROM historique_commande/.test(sql)) return [{ id: ID, n: '7' }];
      return [];
    });
    const r = await Vendeurs.vendeurs({ periode: '30' }, MAINTENANT);
    expect(r).toMatchObject({ total: 1, page: 1, pages: 1, par: 20 });
    expect(r.vendeurs[0]).toMatchObject({
      appareil: 'Application', jours_actifs: 5, vitrine_active: true,
      activite: { produits: 3, commandes: 7, promotions: 0, messages: 0, connexions: 0, visites_boutique: 0 },
    });
    expect(r.vendeurs[0].agent).toBeUndefined();
    expect(mockQuery.mock.calls[0][0]).toContain('derniere_activite >= :du');
  });

  it('« tous » montre aussi ceux qui ne sont pas venus', async () => {
    mockQuery.mockResolvedValue([]);
    await Vendeurs.vendeurs({ filtre: 'tous' }, MAINTENANT);
    expect(mockQuery.mock.calls[0][0]).not.toContain('derniere_activite >= :du');
  });
});

describe('Le fil d’activité d’un vendeur', () => {
  it('mêle connexions, sessions, produits et commandes, du plus récent au plus ancien', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/FROM utilisateur u/.test(sql)) return [{ id: ID, nom: 'Ndiaye', prenom: 'Awa', vitrine_active: true, vitrine_creee_le: '2026-11-25T09:00:00Z', slug: 'chez-awa' }];
      if (/FROM connexion_utilisateur/.test(sql)) return [{ date: '2026-11-26T08:00:00Z', application: false, navigateur: 'Chrome', os: 'Windows' }];
      if (/FROM refresh_token/.test(sql)) return [{ date: '2026-11-26T11:00:00Z', n: '4', agent: 'Dart/3.9 (dart:io)' }];
      if (/FROM produit/.test(sql)) return [{ date: '2026-11-24T10:00:00Z', nom: 'Boubou brodé' }];
      if (/FROM historique_commande/.test(sql)) return [{ date: '2026-11-26T10:00:00Z', operation: 'statut', statut_apres: 'livree', reference: 'SB-0042' }];
      return [];
    });
    const r = await Vendeurs.activites(ID, '7', MAINTENANT);
    expect(r.evenements.map((e) => e.type)).toEqual(['session', 'commande', 'connexion', 'boutique', 'produit']);
    expect(r.evenements[0].detail).toBe('Application · 4 reprises de session');
    expect(r.evenements[1]).toMatchObject({ titre: 'Commande SB-0042', detail: 'a passé la commande en « livrée »' });
    expect(r.evenements[2].detail).toBe('Chrome · Windows');
    expect(r.vendeur.vitrine_creee_le).toBeUndefined();
  });

  it('refuse un identifiant qui n’est pas un vendeur', async () => {
    await expect(Vendeurs.activites('pas-un-uuid', '7', MAINTENANT)).rejects.toMatchObject({ status: 404 });
    mockQuery.mockResolvedValue([]);
    await expect(Vendeurs.activites(ID, '7', MAINTENANT)).rejects.toMatchObject({ status: 404 });
  });
});

describe('Le journal des connexions', () => {
  it('reconnaît l’application et ne garde que l’adresse tronquée', async () => {
    mockQuery.mockResolvedValue([]);
    await expect(Connexions.enregistrer({ utilisateurId: ID, userAgent: 'Dart/3.9 (dart:io)', ip: '41.82.10.55' })).resolves.toBe(true);
    expect(mockQuery.mock.calls[0][1].replacements).toMatchObject({ application: true, appareil: 'Mobile', navigateur: null, ipAnonyme: '41.82.10.0' });
  });

  it('ne fait jamais échouer une connexion', async () => {
    mockQuery.mockRejectedValue(new Error('table absente'));
    await expect(Connexions.enregistrer({ utilisateurId: ID, userAgent: 'x' })).resolves.toBe(false);
  });
});
