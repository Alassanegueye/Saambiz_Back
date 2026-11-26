/**
 * Les e-mails du back-office Kodafrik (création de compte, code d'accès,
 * réponse à un message…), auparavant envoyés par le PHP de kodafrik.com.
 * Ce qui compte : rien de saisi n'est injecté dans le HTML, un modèle
 * incomplet est refusé avant l'envoi, l'aperçu n'envoie rien, et chaque envoi
 * est journalisé sans son contenu.
 */

const mockQuery = jest.fn();
const mockEnvoi = jest.fn();

jest.mock('../../src/config/db', () => ({
  query: (...a) => mockQuery(...a),
  QueryTypes: { SELECT: 'SELECT' },
  define: jest.fn(() => ({})),
}));
jest.mock('../../src/services/resend.service', () => ({ sendEmail: (...a) => mockEnvoi(...a) }));
jest.mock('../../src/utils/logger', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }));

const Mails = require('../../src/services/sites/mails.service');
const { MODELES, rendre } = require('../../src/services/sites/mails.kodafrik');

const BIENVENUE = { modele: 'bienvenue', a: 'awa@kodafrik.com', prenom: 'Awa', donnees: { email: 'awa@kodafrik.com', codeAcces: '0427', espaces: ['SaamBiz', 'Terangaloc'], motDePasse: 'Prov-1234' } };

beforeEach(() => {
  mockQuery.mockReset();
  mockEnvoi.mockReset();
  mockQuery.mockImplementation(async (sql) => (/SELECT COUNT/.test(sql) ? [{ n: '0' }] : []));
  mockEnvoi.mockResolvedValue({ id: 'resend-1' });
  delete process.env.KODAFRIK_MAIL_FROM;
});

describe('Les modèles', () => {
  it('rendent tous un sujet, un HTML à la charte Kodafrik et une version texte', () => {
    const donnees = { prenom: 'Awa', email: 'a@b.sn', codeAcces: '0427', espaces: ['SaamBiz'], message: 'Bonjour', sujet: 'Info', nom: 'Fatou' };
    for (const modele of [...Object.keys(MODELES), 'contact_recu']) {
      const r = rendre(modele, donnees);
      expect(r.sujet).toBeTruthy();
      expect(r.html).toContain('Kodafrik');
      expect(r.html).toContain('#101F45');
      expect(r.texte).toContain('kodafrik.com');
    }
  });

  it('échappent tout ce qui est saisi', () => {
    const { html } = rendre('reponse_message', { prenom: '<script>x</script>', message: 'a <b>gras</b>\n\nfin', messageOrigine: '"<img>' });
    expect(html).not.toMatch(/<script>|<b>gras|<img>/);
    expect(html).toContain('&lt;script&gt;');
  });

  it('écrit le code d’accès chiffre par chiffre', () => {
    const { html } = rendre('code_acces', { codeAcces: '0427' });
    for (const c of '0427') expect(html).toContain(`>${c}</td>`);
  });

  it('affiche le logo de chaque espace autorisé dans les pastilles de bienvenue', () => {
    const { html } = rendre('bienvenue', {
      email: 'awa@kodafrik.com',
      codeAcces: '0427',
      motDePasse: 'Prov-1234',
      espaces: ['Kodafrik', 'SaamBiz', 'Terangaloc', 'Kaaylink'],
    });
    expect(html).toContain('/email/espace-kodafrik.png');
    expect(html).toContain('/email/espace-saambiz.png');
    expect(html).toContain('/email/espace-terangaloc.png');
    expect(html).toContain('/email/espace-kaaylink.png');
  });
});

describe('L’envoi', () => {
  it('envoie au nom de Kodafrik, journalise sans le contenu', async () => {
    await expect(Mails.envoyer('kodafrik', BIENVENUE, 'Alassane Gueye')).resolves.toEqual({ envoye: true });
    const [mail] = mockEnvoi.mock.calls[0];
    expect(mail).toMatchObject({ to: 'awa@kodafrik.com', nomAffiche: 'Kodafrik', replyTo: 'contact@kodafrik.com', subject: 'Bienvenue sur le back-office Kodafrik' });
    const journal = mockQuery.mock.calls.find(([sql]) => /INSERT INTO site_mail/.test(sql))[1].replacements;
    expect(journal).toMatchObject({ modele: 'bienvenue', destinataire: 'awa@kodafrik.com', envoye: true, par: 'Alassane Gueye' });
    expect(JSON.stringify(journal)).not.toContain('Prov-1234');
  });

  it('prend l’expéditeur de KODAFRIK_MAIL_FROM une fois le domaine vérifié', async () => {
    process.env.KODAFRIK_MAIL_FROM = 'Kodafrik <contact@kodafrik.com>';
    await Mails.envoyer('kodafrik', BIENVENUE, 'Alassane');
    expect(mockEnvoi.mock.calls[0][0].from).toBe('Kodafrik <contact@kodafrik.com>');
  });

  it('l’aperçu rend le mail sans rien envoyer ni journaliser', async () => {
    const r = await Mails.envoyer('kodafrik', { ...BIENVENUE, apercu: true }, 'Alassane');
    expect(r.sujet).toBe('Bienvenue sur le back-office Kodafrik');
    expect(r.html).toContain('0427'.charAt(0));
    expect(mockEnvoi).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it.each([
    ['un modèle inconnu', { modele: 'pub' }, /Modèle/],
    ['une adresse invalide', { a: 'awa@' }, /destinataire/],
    ['une information manquante', { donnees: { email: 'awa@kodafrik.com', espaces: ['SaamBiz'] } }, /codeAcces/],
    ['un code qui n’a pas quatre chiffres', { donnees: { ...BIENVENUE.donnees, codeAcces: '12' } }, /quatre chiffres/],
  ])('refuse %s (422) avant tout envoi', async (_cas, champs, attendu) => {
    await expect(Mails.envoyer('kodafrik', { ...BIENVENUE, ...champs }, 'Alassane'))
      .rejects.toMatchObject({ status: 422, message: expect.stringMatching(attendu) });
    expect(mockEnvoi).not.toHaveBeenCalled();
  });

  it('arrête un administrateur après 120 envois dans l’heure', async () => {
    mockQuery.mockImplementation(async (sql) => (/SELECT COUNT/.test(sql) ? [{ n: '120' }] : []));
    await expect(Mails.envoyer('kodafrik', BIENVENUE, 'Alassane')).rejects.toMatchObject({ status: 429 });
    expect(mockEnvoi).not.toHaveBeenCalled();
  });

  it('un envoi refusé répond 502 et reste dans le journal', async () => {
    mockEnvoi.mockRejectedValue(new Error('domaine non vérifié'));
    await expect(Mails.envoyer('kodafrik', BIENVENUE, 'Alassane')).rejects.toMatchObject({ status: 502 });
    const journal = mockQuery.mock.calls.find(([sql]) => /INSERT INTO site_mail/.test(sql))[1].replacements;
    expect(journal).toMatchObject({ envoye: false, erreur: 'domaine non vérifié' });
  });

  it('liste les modèles et les derniers envois', async () => {
    mockQuery.mockResolvedValue([{ id: '3', envoye: 1, modele: 'bienvenue' }]);
    const r = await Mails.journal('kodafrik');
    expect(r.modeles.map((m) => m.id)).toContain('reponse_message');
    expect(r.journal).toEqual([{ id: 3, envoye: true, modele: 'bienvenue' }]);
  });

  it('n’existe pas pour un site sans e-mails', async () => {
    await expect(Mails.envoyer('saambiz', BIENVENUE, 'x')).rejects.toMatchObject({ status: 404 });
  });
});
