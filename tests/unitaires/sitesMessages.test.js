/**
 * Le formulaire de contact de kodafrik.com : la demande est enregistrée
 * AVANT le mail — si le mail échoue, elle attend dans le dashboard, le
 * visiteur n'a rien à recommencer. Le mail part vers l'adresse de contact,
 * le client en « répondre à ».
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

const Messages = require('../../src/services/sites/messages.service');

const DEMANDE = {
  nom: 'Fatou\nDiop', entreprise: 'Teranga SARL', email: 'fatou@exemple.sn', telephone: '77 123 45 67',
  type: 'Site web', budget: '1 à 3 M', message: 'Bonjour, nous voulons un site pour notre boutique.',
  session: 'visite1234abcd', page: '/contact',
};

beforeEach(() => {
  mockQuery.mockReset();
  mockEnvoi.mockReset();
  delete process.env.KODAFRIK_CONTACT_EMAIL;
  mockQuery.mockImplementation(async (sql) => (/INSERT INTO site_message/.test(sql) ? [{ id: '12' }] : []));
  mockEnvoi.mockResolvedValue({ id: 'resend-1' });
});

const appels = (motif) => mockQuery.mock.calls.filter(([sql]) => motif.test(sql));

describe('Une demande du formulaire', () => {
  it('est enregistrée, puis envoyée à contact@kodafrik.com avec le client en « répondre à »', async () => {
    const r = await Messages.recevoir('kodafrik', DEMANDE, { ip: '41.82.10.55' });
    expect(r).toEqual({ envoye: true });

    const [[, { replacements: enregistre }]] = appels(/INSERT INTO site_message/);
    expect(enregistre).toMatchObject({
      site: 'kodafrik', nom: 'Fatou Diop', email: 'fatou@exemple.sn', visite: 'visite1234abcd',
      page: '/contact', ipAnonyme: '41.82.10.0',
    });

    expect(mockEnvoi).toHaveBeenCalledTimes(1);
    const [mail] = mockEnvoi.mock.calls[0];
    expect(mail.to).toBe('contact@kodafrik.com');
    expect(mail.replyTo).toBe('Fatou Diop <fatou@exemple.sn>');
    expect(mail.subject).toBe('Demande de devis — Site web — Fatou Diop');
    expect(mail.html).toContain('Teranga SARL');
    expect(appels(/UPDATE site_message SET mail_envoye = true/)).toHaveLength(1);
  });

  it('l’adresse de contact se règle par KODAFRIK_CONTACT_EMAIL', async () => {
    process.env.KODAFRIK_CONTACT_EMAIL = 'devis@kodafrik.com';
    await Messages.recevoir('kodafrik', DEMANDE);
    expect(mockEnvoi.mock.calls[0][0].to).toBe('devis@kodafrik.com');
  });

  it('confirme au visiteur même si le mail échoue : la demande attend dans le dashboard', async () => {
    mockEnvoi.mockRejectedValue(new Error('Resend indisponible'));
    await expect(Messages.recevoir('kodafrik', DEMANDE)).resolves.toEqual({ envoye: true });
    expect(appels(/INSERT INTO site_message/)).toHaveLength(1);
    expect(appels(/mail_envoye = true/)).toHaveLength(0);
  });

  it('fait semblant d’accepter un robot (champ piège), sans rien enregistrer ni envoyer', async () => {
    await expect(Messages.recevoir('kodafrik', { ...DEMANDE, piege: 'http://spam.example' })).resolves.toEqual({ envoye: true });
    await expect(Messages.recevoir('kodafrik', { ...DEMANDE, botcheck: true })).resolves.toEqual({ envoye: true });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockEnvoi).not.toHaveBeenCalled();
  });

  it.each([
    ['sans nom', { nom: 'F' }, /nom/],
    ['avec une adresse invalide', { email: 'fatou@' }, /e-mail/],
    ['avec un projet trop court', { message: 'Bonjour' }, /projet/],
  ])('refuse une demande %s (422), sans rien enregistrer', async (_cas, champs, attendu) => {
    await expect(Messages.recevoir('kodafrik', { ...DEMANDE, ...champs })).rejects.toMatchObject({ status: 422, message: expect.stringMatching(attendu) });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('n’existe pas pour un site sans formulaire', async () => {
    await expect(Messages.recevoir('saambiz', DEMANDE)).rejects.toMatchObject({ status: 404 });
  });

  it('ignore un numéro de visite malformé', async () => {
    await Messages.recevoir('kodafrik', { ...DEMANDE, session: '../../etc' });
    expect(appels(/INSERT INTO site_message/)[0][1].replacements.visite).toBeNull();
  });
});

describe('Dans le dashboard', () => {
  it('liste sans les archivés par défaut, avec le parcours du visiteur', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/SELECT COUNT\(\*\) AS n FROM site_message/.test(sql)) return [{ n: '1' }];
      if (/GROUP BY statut/.test(sql)) return [{ statut: 'nouveau', n: '1' }, { statut: 'archive', n: '4' }];
      if (/FROM site_message/.test(sql)) return [{ id: '12', nom: 'Fatou', visite: 'visite1234abcd', mail_envoye: true, statut: 'nouveau' }];
      if (/FROM site_evenement/.test(sql)) return [{ visite: 'visite1234abcd', chemin: '/', titre: 'Accueil', date: 'x', source: 'Google', appareil: 'Mobile' }];
      return [];
    });
    const r = await Messages.lister('kodafrik', {});
    expect(r).toMatchObject({ total: 1, page: 1, parPage: 20, compteurs: { nouveau: 1, archive: 4 } });
    expect(r.messages[0]).toMatchObject({ id: 12, mail_envoye: true, visite: { source: 'Google', appareil: 'Mobile' } });
    expect(r.messages[0].parcours).toEqual([{ chemin: '/', titre: 'Accueil', date: 'x' }]);
    expect(mockQuery.mock.calls[0][0]).toContain("statut <> 'archive'");
  });

  it('change le statut, et refuse un statut inconnu', async () => {
    mockQuery.mockResolvedValue([{ id: 12 }]);
    await expect(Messages.changerStatut('kodafrik', '12', 'traite', 'Awa Ndiaye')).resolves.toEqual({ id: 12, statut: 'traite' });
    expect(mockQuery.mock.calls[0][1].replacements).toMatchObject({ statut: 'traite', auteur: 'Awa Ndiaye', id: 12, site: 'kodafrik' });
    await expect(Messages.changerStatut('kodafrik', '12', 'supprime')).rejects.toMatchObject({ status: 400 });
    mockQuery.mockResolvedValue([]);
    await expect(Messages.changerStatut('kodafrik', '99', 'lu')).rejects.toMatchObject({ status: 404 });
  });
});
