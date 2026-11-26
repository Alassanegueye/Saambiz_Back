/**
 * Le code d'accès à quatre chiffres des administrateurs : vérifié par le
 * serveur, exigé par isAdmin, bloqué après cinq échecs, fixe pour
 * kodafrik_admin@gmail.com (0000).
 */

const bcrypt = require('bcryptjs');

const mockQuery = jest.fn();
const mockTrouver = jest.fn();

jest.mock('../../src/config/db', () => ({
  query: (...a) => mockQuery(...a),
  define: jest.fn(() => ({})),
}));
jest.mock('../../src/models/utilisateur.model', () => ({ findByPk: (...a) => mockTrouver(...a) }));
jest.mock('../../src/services/refreshToken.service', () => ({ _hash: (t) => `h(${t})` }));
jest.mock('../../src/services/jetonAcces', () => ({
  jetonAcces: (u, o = {}) => `jeton:${u.id}:${o.codeAcces ? 'ca' : '-'}`,
}));

const CodeAcces = require('../../src/services/codeAcces.service');
const isAdmin = require('../../src/middlewares/isAdmin.middleware');

const HASH_1234 = bcrypt.hashSync('1234', 4);
const ADMIN = { id: 'a1', role: 'Admin', email: 'fatou@kodafrik.com' };
const FIXE = { id: 'k1', role: 'Admin', email: 'Kodafrik_Admin@gmail.com' };
const T0 = Date.UTC(2026, 10, 26, 12);

/** Réponses successives de la base, dans l'ordre des requêtes. */
function base(...reponses) {
  mockQuery.mockReset();
  for (const r of reponses) mockQuery.mockResolvedValueOnce(r);
  mockQuery.mockResolvedValue([[], 0]);
}

beforeEach(() => { mockTrouver.mockReset(); delete process.env.CODE_ACCES_ADMIN_OBLIGATOIRE; });

describe('CodeAccesService.verifier', () => {
  it('accepte le bon code, marque la session et rend un jeton qui ouvre l\'administration', async () => {
    base([{ code_hash: HASH_1234, echecs: 0, bloque_jusqua: null }]);
    const r = await CodeAcces.verifier(ADMIN, '1234', { refreshToken: 'rt', maintenant: T0 });
    expect(r).toEqual({ valide: true, token: 'jeton:a1:ca' });
    const marque = mockQuery.mock.calls.find(([sql]) => /UPDATE refresh_token SET code_acces_verifie_le = NOW/.test(sql));
    expect(marque[1].replacements).toEqual({ h: 'h(rt)', id: 'a1' });
  });

  it('refuse un mauvais code (401) et compte l\'échec', async () => {
    base([{ code_hash: HASH_1234, echecs: 1, bloque_jusqua: null }]);
    await expect(CodeAcces.verifier(ADMIN, '9999', { maintenant: T0 })).rejects.toMatchObject({ status: 401, code: 'CODE_ACCES_INCORRECT' });
    const [, { replacements }] = mockQuery.mock.calls[1];
    expect(replacements).toMatchObject({ id: 'a1', echecs: 2, jusqua: null });
  });

  it('bloque 15 min au cinquième échec (423), puis refuse même le bon code', async () => {
    base([{ code_hash: HASH_1234, echecs: 4, bloque_jusqua: null }]);
    await expect(CodeAcces.verifier(ADMIN, '0000', { maintenant: T0 })).rejects.toMatchObject({ status: 423 });
    expect(mockQuery.mock.calls[1][1].replacements.jusqua).toEqual(new Date(T0 + 15 * 60000));

    base([{ code_hash: HASH_1234, echecs: 0, bloque_jusqua: new Date(T0 + 10 * 60000) }]);
    await expect(CodeAcces.verifier(ADMIN, '1234', { maintenant: T0 })).rejects.toMatchObject({ status: 423, code: 'CODE_ACCES_BLOQUE' });
  });

  it('sans code défini, refuse l\'entrée (403) : le mot de passe seul ne suffit jamais', async () => {
    base([]);
    await expect(CodeAcces.verifier(ADMIN, '1234', { maintenant: T0 })).rejects.toMatchObject({ status: 403, code: 'CODE_ACCES_NON_DEFINI' });
  });

  it('refuse un code mal formé et un compte qui n\'est pas administrateur', async () => {
    await expect(CodeAcces.verifier(ADMIN, '12a4')).rejects.toMatchObject({ status: 422 });
    await expect(CodeAcces.verifier({ id: 'v', role: 'Vendeur' }, '1234')).rejects.toMatchObject({ status: 403 });
  });

  it('kodafrik_admin@gmail.com : 0000 seul, quel que soit le code enregistré en base', async () => {
    base([{ code_hash: HASH_1234, echecs: 0, bloque_jusqua: null }]);
    await expect(CodeAcces.verifier(FIXE, '0000', { maintenant: T0 })).resolves.toMatchObject({ valide: true });
    base([{ code_hash: HASH_1234, echecs: 0, bloque_jusqua: null }]);
    await expect(CodeAcces.verifier(FIXE, '1234', { maintenant: T0 })).rejects.toMatchObject({ status: 401 });
    base([]);
    await expect(CodeAcces.verifier(FIXE, '0000', { maintenant: T0 })).resolves.toMatchObject({ valide: true });
  });
});

describe('CodeAccesService.definir', () => {
  it('enregistre le code haché et retire le drapeau des sessions déjà vérifiées', async () => {
    mockTrouver.mockResolvedValue(ADMIN);
    base();
    await CodeAcces.definir('a1', '0427', { auteurId: 's1' });
    const [sql, { replacements }] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO code_acces_admin/);
    expect(replacements.hash).not.toContain('0427');
    expect(bcrypt.compareSync('0427', replacements.hash)).toBe(true);
    expect(mockQuery.mock.calls[1][0]).toMatch(/SET code_acces_verifie_le = NULL/);
  });

  it('refuse de changer le code fixe de kodafrik_admin@gmail.com (409)', async () => {
    mockTrouver.mockResolvedValue(FIXE);
    await expect(CodeAcces.definir('k1', '1111')).rejects.toMatchObject({ status: 409, code: 'CODE_ACCES_FIXE' });
  });

  it('refuse un compte qui n\'est pas administrateur et un code mal formé', async () => {
    mockTrouver.mockResolvedValue({ id: 'v', role: 'Vendeur', email: 'v@x.sn' });
    await expect(CodeAcces.definir('v', '1111')).rejects.toMatchObject({ status: 404 });
    await expect(CodeAcces.definir('a1', '111')).rejects.toMatchObject({ status: 422 });
  });
});

describe('isAdmin exige le code d\'accès', () => {
  function appeler(req) {
    const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
    const next = jest.fn();
    isAdmin(req, res, next);
    return { res, next };
  }

  it('laisse passer un administrateur dont le code est vérifié', () => {
    const { next } = appeler({ user: { role: 'Admin' }, codeAccesVerifie: true });
    expect(next).toHaveBeenCalled();
  });

  it('refuse (403 CODE_ACCES_REQUIS) un administrateur connecté au seul mot de passe', () => {
    const { res, next } = appeler({ user: { role: 'Admin' }, codeAccesVerifie: false });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'CODE_ACCES_REQUIS' }));
  });

  it('CODE_ACCES_ADMIN_OBLIGATOIRE=false (dépannage) rouvre au mot de passe seul', () => {
    process.env.CODE_ACCES_ADMIN_OBLIGATOIRE = 'false';
    const { next } = appeler({ user: { role: 'Admin' } });
    expect(next).toHaveBeenCalled();
  });
});
