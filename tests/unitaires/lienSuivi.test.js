/**
 * LE LIEN DE SUIVI D'UNE COMMANDE PASSÉE SANS COMPTE.
 *
 * Un client du site d'une boutique n'a pas de compte : sans lien, il n'a
 * aucun moyen de revenir voir où en est sa commande. Le suivi se faisait par
 * référence et téléphone — deux valeurs courtes, qui circulent par WhatsApp
 * et s'énumèrent.
 *
 * Ces tests tiennent les quatre promesses faites au client :
 *
 *  1. le jeton est tiré au hasard, et deux liens ne se ressemblent jamais ;
 *  2. la base n'en garde que l'empreinte — une copie de la base ne permet
 *     pas de fabriquer un lien ;
 *  3. il expire au bout de quinze jours, et le dit (410) au lieu de nier
 *     son existence (404) ;
 *  4. il n'ouvre que les commandes passées SANS COMPTE à cette adresse :
 *     ce n'est pas une porte dérobée vers le compte de quelqu'un.
 */

const crypto = require('crypto');

const mockLienCreate = jest.fn();
const mockLienFindOne = jest.fn();
const mockLienFindAll = jest.fn();
const mockLienDestroy = jest.fn();
const mockCommandeFindAll = jest.fn();
const mockCommandeCount = jest.fn();
const mockBoutiqueFindAll = jest.fn();

jest.mock('../../src/models', () => ({
  LienSuivi: {
    create: (...a) => mockLienCreate(...a),
    findOne: (...a) => mockLienFindOne(...a),
    findAll: (...a) => mockLienFindAll(...a),
    destroy: (...a) => mockLienDestroy(...a),
  },
  Commande: {
    findAll: (...a) => mockCommandeFindAll(...a),
    count: (...a) => mockCommandeCount(...a),
  },
  LigneCommande: {},
  Boutique: { findAll: (...a) => mockBoutiqueFindAll(...a) },
}));

const LienSuiviService = require('../../src/services/vitrine/lienSuivi.service');
const { empreinte } = LienSuiviService;

const EMAIL = 'awa@exemple.sn';

describe('liens de suivi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLienCreate.mockImplementation(async (valeurs) => ({ ...valeurs }));
    mockLienFindAll.mockResolvedValue([]);
    mockLienDestroy.mockResolvedValue(0);
    mockCommandeFindAll.mockResolvedValue([]);
    mockBoutiqueFindAll.mockResolvedValue([]);
  });

  // ── 1. Le jeton ────────────────────────────────────────────────────────

  it('tire un jeton de 256 bits, différent à chaque fois', async () => {
    const a = await LienSuiviService.creer(EMAIL);
    const b = await LienSuiviService.creer(EMAIL);

    expect(a.jeton).not.toBe(b.jeton);
    // base64url de 32 octets : 43 caractères, sans « = » ni caractère à
    // échapper dans une URL.
    expect(a.jeton).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a.jeton, 'base64url')).toHaveLength(32);
  });

  it('n’écrit jamais le jeton en clair dans la base', async () => {
    const { jeton } = await LienSuiviService.creer(EMAIL);
    const enregistre = mockLienCreate.mock.calls[0][0];

    expect(enregistre.jetonHash).toBe(crypto.createHash('sha256').update(jeton).digest('hex'));
    expect(JSON.stringify(enregistre)).not.toContain(jeton);
  });

  it('refuse une adresse qui n’en est pas une', async () => {
    await expect(LienSuiviService.creer('pas-une-adresse')).rejects.toThrow(/invalide/i);
    expect(mockLienCreate).not.toHaveBeenCalled();
  });

  // ── 2. La durée ────────────────────────────────────────────────────────

  it('fixe l’échéance à quinze jours', async () => {
    const avant = Date.now();
    await LienSuiviService.creer(EMAIL);
    const { expiresAt } = mockLienCreate.mock.calls[0][0];

    const jours = (expiresAt.getTime() - avant) / (24 * 60 * 60 * 1000);
    expect(jours).toBeGreaterThan(14.9);
    expect(jours).toBeLessThan(15.1);
    expect(LienSuiviService.dureeJours).toBe(15);
  });

  // ── 3. L'ouverture ─────────────────────────────────────────────────────

  it('retrouve le lien par l’empreinte du jeton, jamais par le jeton', async () => {
    mockLienFindOne.mockResolvedValue(null);
    await expect(LienSuiviService.ouvrir('unJetonQuelconque')).rejects.toThrow(/introuvable/i);

    const where = mockLienFindOne.mock.calls[0][0].where;
    expect(where.jetonHash).toBe(empreinte('unJetonQuelconque'));
    expect(where.jetonHash).not.toBe('unJetonQuelconque');
  });

  it('distingue un lien expiré d’un lien inconnu', async () => {
    const update = jest.fn();
    mockLienFindOne.mockResolvedValue({
      email: EMAIL,
      commandeId: null,
      expiresAt: new Date(Date.now() - 1000),
      update,
    });

    // 410 Gone : il a existé. C'est ce que l'écran « demandez-en un autre »
    // attend — un 404 lui ferait dire « lien inconnu », ce qui est faux.
    await expect(LienSuiviService.ouvrir('jeton')).rejects.toMatchObject({
      status: 410,
      code: 'LIEN_EXPIRE',
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('ouvre un lien valide et note sa consultation', async () => {
    const update = jest.fn();
    mockLienFindOne.mockResolvedValue({
      email: EMAIL,
      commandeId: 'cmd-1',
      expiresAt: new Date(Date.now() + 86400000),
      update,
    });

    const data = await LienSuiviService.ouvrir('jeton');

    expect(data.email).toBe(EMAIL);
    expect(data.commandeOuverte).toBe('cmd-1');
    expect(update).toHaveBeenCalledWith({ derniereUtilisation: expect.any(Date) });
  });

  it('refuse un jeton absurdement long sans interroger la base', async () => {
    await expect(LienSuiviService.ouvrir('x'.repeat(5000))).rejects.toThrow(/introuvable/i);
    expect(mockLienFindOne).not.toHaveBeenCalled();
  });

  // ── 4. Ce que le lien ouvre ────────────────────────────────────────────

  it('ne montre que les commandes passées sans compte à cette adresse', async () => {
    await LienSuiviService.commandesDe(EMAIL);

    const where = mockCommandeFindAll.mock.calls[0][0].where;
    expect(where.clientEmail).toBe(EMAIL);
    // La condition qui empêche le lien d'ouvrir les commandes d'un compte
    // dont on ne connaîtrait que l'adresse.
    expect(where.acheteurId).toBeNull();
  });

  it('normalise l’adresse : la casse ne crée pas deux clients', async () => {
    await LienSuiviService.commandesDe('  AWA@Exemple.SN  ');
    expect(mockCommandeFindAll.mock.calls[0][0].where.clientEmail).toBe(EMAIL);
  });

  it('dit s’il existe des commandes derrière une adresse', async () => {
    mockCommandeCount.mockResolvedValue(2);
    await expect(LienSuiviService.aDesCommandes(EMAIL)).resolves.toBe(true);

    mockCommandeCount.mockResolvedValue(0);
    await expect(LienSuiviService.aDesCommandes(EMAIL)).resolves.toBe(false);

    // Une adresse invalide ne doit pas même atteindre la base.
    mockCommandeCount.mockClear();
    await expect(LienSuiviService.aDesCommandes('n’importe quoi')).resolves.toBe(false);
    expect(mockCommandeCount).not.toHaveBeenCalled();
  });

  // ── 5. L'adresse publique ──────────────────────────────────────────────

  it('construit une adresse de suivi sur le domaine de la vitrine', () => {
    const url = LienSuiviService.url('AbC-123_xyz');
    expect(url).toMatch(/\/suivi\/AbC-123_xyz$/);
    expect(url).toMatch(/^https?:\/\//);
    expect(url).not.toMatch(/\/\/suivi/);
  });
});
