/**
 * Suivi d'une commande sur saambiz.com, avec son numéro SEUL.
 *
 * Le numéro (CMD-XXXX-XXXX-XXXX, 60 bits) est le secret qui ouvre la
 * commande : la voir, la modifier tant que la boutique ne l'a pas acceptée,
 * l'annuler tant qu'elle n'est pas en préparation. Les anciens numéros, plus
 * courts, demandent encore le téléphone et restent en lecture seule.
 */
const VitrineService = require('../../src/services/vitrine/vitrine.service');
const CommandeService = require('../../src/services/commandes/commande.service');
const { Commande, Boutique } = require('../../src/models');

const REF = 'CMD-0A1B-2C3D-4E5F';

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
  it('retrouve la commande avec le numéro seul, même mal saisi', async () => {
    jest.spyOn(Commande, 'findOne').mockResolvedValue(commande());
    const r = await VitrineService.suivreParNumero('cmd oa1b 2c3d 4e5f');
    expect(Commande.findOne.mock.calls[0][0].where).toEqual({ referenceCommande: REF });
    expect(r).toMatchObject({ reference: REF, statut: 'en_attente', actions: { modifier: true, annuler: true } });
  });

  it('répond la même chose pour un numéro inconnu et pour un format invalide', async () => {
    jest.spyOn(Commande, 'findOne').mockResolvedValue(null);
    await expect(VitrineService.suivreParNumero(REF)).rejects.toMatchObject({ status: 404 });
    await expect(VitrineService.suivreParNumero('n\'importe quoi')).rejects.toMatchObject({ status: 404 });
  });

  it('un ancien numéro demande le téléphone, et reste en lecture seule', async () => {
    const ancienne = commande({ referenceCommande: 'CMD-2026-ABC123' });
    jest.spyOn(Commande, 'findOne').mockResolvedValue(ancienne);
    await expect(VitrineService.suivreParNumero('CMD-2026-ABC123')).rejects.toMatchObject({ status: 400, code: 'TELEPHONE_REQUIS' });
    await expect(VitrineService.suivreParNumero('CMD-2026-ABC123', '76 000 00 00')).rejects.toMatchObject({ status: 404 });
    const r = await VitrineService.suivreParNumero('CMD-2026-ABC123', '77 123 45 67');
    expect(r.actions).toMatchObject({ modifier: false, annuler: false });
  });

  it('une commande passée dans l\'application se consulte mais se gère dans l\'application', async () => {
    jest.spyOn(Commande, 'findOne').mockResolvedValue(commande({ acheteurId: 'a1' }));
    const r = await VitrineService.suivreParNumero(REF);
    expect(r.actions.modifier).toBe(false);
    expect(r.actions.raison).toMatch(/application/);
    expect(r.client).toBeNull();
  });
});

describe('modifier', () => {
  it('change l\'adresse et le téléphone avant acceptation, et prévient la boutique', async () => {
    const c = commande();
    jest.spyOn(Commande, 'findOne').mockResolvedValue(c);
    const r = await VitrineService.modifierParNumero(REF, { adresseLivraison: ' Mermoz, villa 12 ', telephone: '78 111 22 33' });
    expect(c.update).toHaveBeenCalledWith({ adresseLivraison: 'Mermoz, villa 12', numeroTelephone: '+221781112233', clientTelephone: '+221781112233' });
    expect(r.adresseLivraison).toBe('Mermoz, villa 12');
    expect(CommandeService._notifierUtilisateur).toHaveBeenCalledWith('v1', 'Commande modifiée par le client', expect.stringContaining("l'adresse, le téléphone"), expect.any(Object));
  });

  it('refuse une fois la commande prise en charge, ou une adresse vide en livraison', async () => {
    jest.spyOn(Commande, 'findOne').mockResolvedValue(commande({ statut: 'confirmee' }));
    await expect(VitrineService.modifierParNumero(REF, { note: 'x' })).rejects.toMatchObject({ status: 400 });
    Commande.findOne.mockResolvedValue(commande());
    await expect(VitrineService.modifierParNumero(REF, { adresseLivraison: '  ' })).rejects.toThrow(/adresse/);
  });

  it('refuse un ancien numéro et une commande de l\'application', async () => {
    jest.spyOn(Commande, 'findOne').mockResolvedValue(commande({ acheteurId: 'a1' }));
    await expect(VitrineService.modifierParNumero(REF, { note: 'x' })).rejects.toMatchObject({ status: 403 });
    await expect(VitrineService.modifierParNumero('CMD-2026-ABC123', { note: 'x' })).rejects.toMatchObject({ status: 400 });
  });
});

describe('annuler', () => {
  it('annule avant la préparation', async () => {
    const c = commande();
    jest.spyOn(Commande, 'findOne').mockResolvedValue(c);
    jest.spyOn(Commande, 'findByPk').mockResolvedValue({ ...c, statut: 'annulee', annulationMotif: 'Plus besoin' });
    const annuler = jest.spyOn(CommandeService, '_annuler').mockResolvedValue({});
    const r = await VitrineService.annulerParNumero(REF, { motif: 'Plus besoin' });
    expect(annuler).toHaveBeenCalledWith(c, 'acheteur', 'annulee', { motif: 'Plus besoin' });
    expect(r.statut).toBe('annulee');
  });

  it('refuse en préparation ou une fois payée', async () => {
    jest.spyOn(Commande, 'findOne').mockResolvedValue(commande({ statut: 'en_preparation' }));
    await expect(VitrineService.annulerParNumero(REF)).rejects.toThrow(/préparation/);
    Commande.findOne.mockResolvedValue(commande({ statutPaiement: 'paye' }));
    await expect(VitrineService.annulerParNumero(REF)).rejects.toThrow(/payée/);
  });
});
