/**
 * Suivi d'une commande sur saambiz.com : NUMÉRO DE COMMANDE et TÉLÉPHONE.
 *
 * Le téléphone doit être celui de la personne qui a commandé : sinon, on le
 * lui dit (« ne correspond pas »). Les deux sont exigés pour voir, modifier
 * (avant acceptation) et annuler (avant préparation).
 */
const VitrineService = require('../../src/services/vitrine/vitrine.service');
const CommandeService = require('../../src/services/commandes/commande.service');
const { Commande, Boutique } = require('../../src/models');

const REF = 'CMD-0A1B-2C3D-4E5F';
const TEL = '77 123 45 67';

function commande(surcharges = {}) {
  const c = {
    id: 'c1', referenceCommande: REF, vendeurId: 'v1', acheteurId: null,
    statut: 'en_attente', statutPaiement: 'en_attente', modeLivraison: 'livraison', modePaiement: 'a_la_livraison',
    adresseLivraison: 'Sacré-Cœur 3', numeroTelephone: '+221771234567', clientTelephone: '+221771234567',
    clientPrenom: 'Awa', clientNom: 'Diop', note: null, montantTotal: 12000, lignes: [],
    createdAt: new Date('2026-11-26T10:00:00Z'), updatedAt: new Date('2026-11-26T10:00:00Z'),
    ...surcharges,
  };
  c.update = jest.fn(async (v) => Object.assign(c, v));
  return c;
}

beforeEach(() => {
  jest.restoreAllMocks();
  jest.spyOn(Boutique, 'findOne').mockResolvedValue({ nom: 'Chez Awa', slug: 'chez-awa', vitrineActive: true, telephone: '+221770000000' });
  jest.spyOn(CommandeService, '_historiser').mockImplementation(() => {});
  jest.spyOn(CommandeService, '_notifierUtilisateur').mockResolvedValue();
  jest.spyOn(CommandeService, '_diffuserStatut').mockImplementation(() => {});
});

describe('consulter', () => {
  it('numéro (même mal saisi) et téléphone de la personne qui a commandé : la commande', async () => {
    jest.spyOn(Commande, 'findOne').mockResolvedValue(commande());
    const r = await VitrineService.suivreParNumero('cmd oa1b 2c3d 4e5f', '+221 77 123 45 67');
    expect(Commande.findOne.mock.calls[0][0].where).toEqual({ referenceCommande: REF });
    expect(r).toMatchObject({ reference: REF, statut: 'en_attente', actions: { modifier: true, annuler: true } });
  });

  it('sans téléphone : refusé avant même de chercher la commande', async () => {
    jest.spyOn(Commande, 'findOne');
    await expect(VitrineService.suivreParNumero(REF)).rejects.toMatchObject({ status: 400, code: 'TELEPHONE_REQUIS' });
    await expect(VitrineService.suivreParNumero(REF, '12')).rejects.toMatchObject({ status: 400 });
    expect(Commande.findOne).not.toHaveBeenCalled();
  });

  it('téléphone d’une autre personne : « ne correspond pas »', async () => {
    jest.spyOn(Commande, 'findOne').mockResolvedValue(commande());
    await expect(VitrineService.suivreParNumero(REF, '76 000 00 00'))
      .rejects.toMatchObject({ status: 403, code: 'TELEPHONE_INCORRECT', message: expect.stringMatching(/ne correspond pas/) });
  });

  it('le numéro de livraison changé n’ouvre pas le suivi : seul celui du client compte', async () => {
    jest.spyOn(Commande, 'findOne').mockResolvedValue(commande({ numeroTelephone: '+221781112233' }));
    await expect(VitrineService.suivreParNumero(REF, '78 111 22 33')).rejects.toMatchObject({ code: 'TELEPHONE_INCORRECT' });
    await expect(VitrineService.suivreParNumero(REF, TEL)).resolves.toMatchObject({ reference: REF });
  });

  it('numéro inconnu ou mal formé : 404', async () => {
    jest.spyOn(Commande, 'findOne').mockResolvedValue(null);
    await expect(VitrineService.suivreParNumero(REF, TEL)).rejects.toMatchObject({ status: 404 });
    await expect(VitrineService.suivreParNumero('n\'importe quoi', TEL)).rejects.toMatchObject({ status: 404 });
  });

  it('un ancien numéro suit la même règle', async () => {
    jest.spyOn(Commande, 'findOne').mockResolvedValue(commande({ referenceCommande: 'CMD-2026-ABC123' }));
    const r = await VitrineService.suivreParNumero('cmd-2026-abc123', TEL);
    expect(Commande.findOne.mock.calls[0][0].where).toEqual({ referenceCommande: 'CMD-2026-ABC123' });
    expect(r.actions.modifier).toBe(true);
  });

  it('une commande passée dans l\'application : le téléphone du compte, et gestion dans l\'application', async () => {
    jest.spyOn(Commande, 'findOne').mockResolvedValue(commande({
      acheteurId: 'a1', clientTelephone: null, acheteur: { telephone: '+221771234567' },
    }));
    const r = await VitrineService.suivreParNumero(REF, TEL);
    expect(r.actions.modifier).toBe(false);
    expect(r.actions.raison).toMatch(/application/);
    expect(r.client).toBeNull();
  });
});

describe('modifier', () => {
  it('change l\'adresse et le téléphone de livraison avant acceptation, et prévient la boutique', async () => {
    const c = commande();
    jest.spyOn(Commande, 'findOne').mockResolvedValue(c);
    const r = await VitrineService.modifierParNumero(REF, { telephoneClient: TEL, adresseLivraison: ' Mermoz, villa 12 ', telephone: '78 111 22 33' });
    expect(c.update).toHaveBeenCalledWith({ adresseLivraison: 'Mermoz, villa 12', numeroTelephone: '+221781112233' });
    expect(c.clientTelephone).toBe('+221771234567');
    expect(r.adresseLivraison).toBe('Mermoz, villa 12');
    expect(CommandeService._notifierUtilisateur).toHaveBeenCalledWith('v1', 'Commande modifiée par le client', expect.stringContaining("l'adresse, le téléphone"), expect.any(Object));
  });

  it('exige le téléphone du client', async () => {
    jest.spyOn(Commande, 'findOne').mockResolvedValue(commande());
    await expect(VitrineService.modifierParNumero(REF, { note: 'x' })).rejects.toMatchObject({ status: 400 });
    await expect(VitrineService.modifierParNumero(REF, { telephoneClient: '76 000 00 00', note: 'x' })).rejects.toMatchObject({ status: 403 });
  });

  it('refuse une fois la commande prise en charge, ou une adresse vide en livraison', async () => {
    jest.spyOn(Commande, 'findOne').mockResolvedValue(commande({ statut: 'confirmee' }));
    await expect(VitrineService.modifierParNumero(REF, { telephoneClient: TEL, note: 'x' })).rejects.toMatchObject({ status: 400 });
    Commande.findOne.mockResolvedValue(commande());
    await expect(VitrineService.modifierParNumero(REF, { telephoneClient: TEL, adresseLivraison: '  ' })).rejects.toThrow(/adresse/);
  });
});

describe('annuler', () => {
  it('annule avant la préparation', async () => {
    const c = commande();
    jest.spyOn(Commande, 'findOne').mockResolvedValue(c);
    jest.spyOn(Commande, 'findByPk').mockResolvedValue({ ...c, statut: 'annulee', annulationMotif: 'Plus besoin' });
    const annuler = jest.spyOn(CommandeService, '_annuler').mockResolvedValue({});
    const r = await VitrineService.annulerParNumero(REF, { telephoneClient: TEL, motif: 'Plus besoin' });
    expect(annuler).toHaveBeenCalledWith(c, 'acheteur', 'annulee', { motif: 'Plus besoin' });
    expect(r.statut).toBe('annulee');
  });

  it('refuse en préparation, une fois payée, ou avec un autre téléphone', async () => {
    jest.spyOn(Commande, 'findOne').mockResolvedValue(commande({ statut: 'en_preparation' }));
    await expect(VitrineService.annulerParNumero(REF, { telephoneClient: TEL })).rejects.toThrow(/préparation/);
    Commande.findOne.mockResolvedValue(commande({ statutPaiement: 'paye' }));
    await expect(VitrineService.annulerParNumero(REF, { telephoneClient: TEL })).rejects.toThrow(/payée/);
    Commande.findOne.mockResolvedValue(commande());
    await expect(VitrineService.annulerParNumero(REF, { telephoneClient: '76 000 00 00' })).rejects.toMatchObject({ code: 'TELEPHONE_INCORRECT' });
  });
});
