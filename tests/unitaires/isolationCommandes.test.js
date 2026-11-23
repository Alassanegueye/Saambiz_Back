/**
 * ISOLATION DES COMMANDES — et le montant, qui ne se négocie pas.
 *
 * Une commande est la donnée la plus sensible de la plateforme : elle porte
 * le nom, le téléphone et l'adresse d'un client, ce qu'il a acheté et combien
 * il a payé. Deux parties seulement y ont droit, l'acheteur et le vendeur
 * concernés.
 *
 * L'audit du 23 novembre 2026 a vérifié par lecture que les six mutations
 * contrôlent la propriété (commande.service.js:667, 705, 786, 899, 938, 982).
 * Aucun test ne l'exerçait. Ce fichier le fait.
 *
 * Une nuance que ces tests rendent visible : contrairement aux produits, où
 * la contrainte vit DANS la clause `where`, les commandes sont chargées par
 * leur seul identifiant puis comparées. C'est correct aujourd'hui, et plus
 * fragile — la protection vit dans une branche qu'un nouveau chemin d'appel
 * peut oublier. D'où l'intérêt de la retenir ici.
 *
 * Couvre les contrôles A-09 à A-14, C-18 et D-25 du rapport.
 */

const mockCommandeFindByPk = jest.fn();
const mockCommandeFindOne = jest.fn();
const mockCommandeFindAll = jest.fn();
const mockCommandeFindAndCountAll = jest.fn();
const mockCommandeCreate = jest.fn();
const mockProduitFindAll = jest.fn();
const mockLigneFindAll = jest.fn();

const mockModeleFactice = () => ({
  findOne: jest.fn(), findAll: jest.fn(), findByPk: jest.fn(),
  create: jest.fn(), update: jest.fn(), destroy: jest.fn(), count: jest.fn(),
  belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(),
  belongsToMany: jest.fn(), addHook: jest.fn(), sync: jest.fn(),
});

jest.mock('../../src/config/db', () => ({
  define: () => mockModeleFactice(),
  // `changerStatut` enveloppe sa lecture dans une transaction à rappel :
  // la doublure doit donc exécuter ce rappel, pas seulement rendre un objet.
  transaction: async (rappel) => {
    const t = { commit: jest.fn(), rollback: jest.fn(), LOCK: { UPDATE: 'UPDATE' } };
    if (typeof rappel === 'function') return rappel(t);
    return t;
  },
  query: jest.fn(),
  fn: (...a) => ({ fn: a }),
  col: (...a) => ({ col: a }),
  literal: (...a) => ({ literal: a }),
  authenticate: jest.fn(),
  QueryTypes: { SELECT: 'SELECT' },
}));

jest.mock('../../src/models', () => ({
  Commande: {
    findByPk: (...a) => mockCommandeFindByPk(...a),
    findOne: (...a) => mockCommandeFindOne(...a),
    findAll: (...a) => mockCommandeFindAll(...a),
    findAndCountAll: (...a) => mockCommandeFindAndCountAll(...a),
    create: (...a) => mockCommandeCreate(...a),
    count: jest.fn(), sum: jest.fn(), update: jest.fn(),
  },
  LigneCommande: {
    findAll: (...a) => mockLigneFindAll(...a),
    bulkCreate: jest.fn(),
  },
  Produit: {
    findAll: (...a) => mockProduitFindAll(...a),
    findByPk: jest.fn(), findOne: jest.fn(), update: jest.fn(),
    increment: jest.fn(), count: jest.fn(),
  },
  Utilisateur: { findByPk: jest.fn(), findOne: jest.fn() },
  Boutique: { findOne: jest.fn(), findByPk: jest.fn() },
  HistoriqueCommande: { create: jest.fn(), findAll: jest.fn() },
}));

jest.mock('../../src/services/notifications/notification.service', () => ({
  notifierUtilisateur: jest.fn(),
  notifierUtilisateurs: jest.fn(),
  notifierAbonnesDuVendeur: jest.fn(),
  creerNotification: jest.fn(),
}));

const CommandeService = require('../../src/services/commandes/commande.service');

const ACHETEUR_C = 'cccccccc-0000-4000-8000-00000000000c';
const ACHETEUR_D = 'dddddddd-0000-4000-8000-00000000000d';
const VENDEUR_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const VENDEUR_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const COMMANDE = '11111111-0000-4000-8000-000000000001';

/** Une commande entre l'acheteur C et le vendeur A. */
function commandeDeCEtA(extra = {}) {
  return {
    id: COMMANDE,
    acheteurId: ACHETEUR_C,
    vendeurId: VENDEUR_A,
    statut: 'en_attente',
    statutPaiement: 'non_paye',
    modePaiement: 'a_la_livraison',
    montantTotal: '25000',
    referenceCommande: 'CMD-2026-TEST01',
    clientTelephone: '+221771234567',
    update: jest.fn(),
    ...extra,
  };
}

beforeEach(() => {
  for (const m of [
    mockCommandeFindByPk, mockCommandeFindOne, mockCommandeFindAll,
    mockCommandeFindAndCountAll, mockCommandeCreate, mockProduitFindAll,
    mockLigneFindAll,
  ]) m.mockReset();
  mockLigneFindAll.mockResolvedValue([]);
});

// ═══════════════════════════════════════════════════════════════════════════
//  T-02 — lecture
// ═══════════════════════════════════════════════════════════════════════════

describe('T-02 — lire une commande', () => {
  it('l\'acheteur concerné y a accès', async () => {
    mockCommandeFindOne.mockResolvedValue(commandeDeCEtA());
    mockCommandeFindByPk.mockResolvedValue(commandeDeCEtA());

    const c = await CommandeService.getCommandePourUtilisateur(COMMANDE, ACHETEUR_C);
    expect(c.id).toBe(COMMANDE);
  });

  it('le vendeur concerné y a accès', async () => {
    mockCommandeFindOne.mockResolvedValue(commandeDeCEtA());
    mockCommandeFindByPk.mockResolvedValue(commandeDeCEtA());

    const c = await CommandeService.getCommandePourUtilisateur(COMMANDE, VENDEUR_A);
    expect(c.id).toBe(COMMANDE);
  });

  it('un AUTRE acheteur est refusé', async () => {
    mockCommandeFindOne.mockResolvedValue(commandeDeCEtA());
    mockCommandeFindByPk.mockResolvedValue(commandeDeCEtA());

    await expect(
      CommandeService.getCommandePourUtilisateur(COMMANDE, ACHETEUR_D),
    ).rejects.toThrow(/refus/i);
  });

  it('un AUTRE vendeur est refusé — c\'est le cas inter-boutiques', async () => {
    mockCommandeFindOne.mockResolvedValue(commandeDeCEtA());
    mockCommandeFindByPk.mockResolvedValue(commandeDeCEtA());

    await expect(
      CommandeService.getCommandePourUtilisateur(COMMANDE, VENDEUR_B),
    ).rejects.toThrow(/refus/i);
  });

  it('la liste de l\'acheteur est bornée à son identifiant', async () => {
    mockCommandeFindAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await CommandeService.mesCommandes(ACHETEUR_C, { statut: 'livree' });

    const { where } = mockCommandeFindAndCountAll.mock.calls[0][0];
    expect(where).toEqual(expect.objectContaining({ acheteurId: ACHETEUR_C }));
  });

  it('la liste du vendeur est bornée à son identifiant', async () => {
    mockCommandeFindAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await CommandeService.commandesVendeur(VENDEUR_A, { origine: 'vitrine' });

    const { where } = mockCommandeFindAndCountAll.mock.calls[0][0];
    expect(where).toEqual(expect.objectContaining({ vendeurId: VENDEUR_A }));
  });

  it('un filtre de la requête ne peut pas réécrire le bornage', async () => {
    mockCommandeFindAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    // Le client tente de se substituer un autre vendeur.
    await CommandeService.commandesVendeur(VENDEUR_A, { vendeurId: VENDEUR_B });

    const { where } = mockCommandeFindAndCountAll.mock.calls[0][0];
    expect(where.vendeurId).toBe(VENDEUR_A);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  T-02 — mutations
// ═══════════════════════════════════════════════════════════════════════════

describe('T-02 — faire avancer ou annuler une commande', () => {
  it('un autre vendeur ne peut pas changer le statut', async () => {
    const commande = commandeDeCEtA({ statut: 'en_attente' });
    mockCommandeFindByPk.mockResolvedValue(commande);

    await expect(
      CommandeService.changerStatut(COMMANDE, VENDEUR_B, 'acceptee'),
    ).rejects.toThrow(/appartient/i);

    expect(commande.update).not.toHaveBeenCalled();
  });

  it('un autre vendeur ne peut pas confirmer le paiement', async () => {
    const commande = commandeDeCEtA({ statut: 'livree' });
    mockCommandeFindByPk.mockResolvedValue(commande);

    await expect(
      CommandeService.confirmerPaiementVendeur(COMMANDE, VENDEUR_B),
    ).rejects.toThrow();

    expect(commande.update).not.toHaveBeenCalled();
  });

  it('un autre acheteur ne peut pas annuler', async () => {
    const commande = commandeDeCEtA();
    mockCommandeFindByPk.mockResolvedValue(commande);

    await expect(
      CommandeService.annulerCommande(COMMANDE, ACHETEUR_D),
    ).rejects.toThrow();

    expect(commande.update).not.toHaveBeenCalled();
  });

  it('un autre acheteur ne peut pas demander l\'annulation', async () => {
    const commande = commandeDeCEtA({ statut: 'en_preparation' });
    mockCommandeFindByPk.mockResolvedValue(commande);

    await expect(
      CommandeService.demanderAnnulation(COMMANDE, ACHETEUR_D, 'motif'),
    ).rejects.toThrow();

    expect(commande.update).not.toHaveBeenCalled();
  });

  it('un autre vendeur ne peut pas répondre à une demande d\'annulation', async () => {
    const commande = commandeDeCEtA({ statut: 'en_preparation', annulationDemandee: true });
    mockCommandeFindByPk.mockResolvedValue(commande);

    await expect(
      CommandeService.repondreDemandeAnnulation(COMMANDE, VENDEUR_B, { accepte: true }),
    ).rejects.toThrow();

    expect(commande.update).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  A-14 — une commande, une seule boutique
// ═══════════════════════════════════════════════════════════════════════════

describe('A-14 — un panier ne peut pas mélanger deux boutiques', () => {
  it('refuse un panier dont les produits viennent de deux vendeurs', async () => {
    mockProduitFindAll.mockResolvedValue([
      { id: 'p-a', nom: 'Sac', vendeurId: VENDEUR_A, disponible: true, quantite: 5, prix: '10000', prix_promo: null },
      { id: 'p-b', nom: 'Montre', vendeurId: VENDEUR_B, disponible: true, quantite: 5, prix: '15000', prix_promo: null },
    ]);

    await expect(
      CommandeService.creerCommande({
        acheteurId: ACHETEUR_C,
        items: [{ produitId: 'p-a', quantite: 1 }, { produitId: 'p-b', quantite: 1 }],
        modeLivraison: 'retrait',
        modePaiement: 'a_la_livraison',
        numeroTelephone: '+221771234567',
      }),
    ).rejects.toThrow(/même boutique/i);

    expect(mockCommandeCreate).not.toHaveBeenCalled();
  });

  it('refuse qu\'un vendeur commande ses propres produits', async () => {
    mockProduitFindAll.mockResolvedValue([
      { id: 'p-a', nom: 'Sac', vendeurId: VENDEUR_A, disponible: true, quantite: 5, prix: '10000', prix_promo: null },
    ]);

    await expect(
      CommandeService.creerCommande({
        acheteurId: VENDEUR_A,
        items: [{ produitId: 'p-a', quantite: 1 }],
        modeLivraison: 'retrait',
        modePaiement: 'a_la_livraison',
        numeroTelephone: '+221771234567',
      }),
    ).rejects.toThrow(/vos propres produits/i);

    expect(mockCommandeCreate).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  T-21 — le montant est décidé par le serveur, jamais par le client
// ═══════════════════════════════════════════════════════════════════════════

describe('T-21 — le client ne décide pas du montant', () => {
  const produit = () => ({
    id: 'p-a', nom: 'Sac en wax', vendeurId: VENDEUR_A,
    disponible: true, quantite: 10, prix: '25000', prix_promo: null,
  });

  it('un prix envoyé dans la requête est ignoré : le montant vient de la base', async () => {
    mockProduitFindAll.mockResolvedValue([produit()]);
    mockCommandeCreate.mockResolvedValue({ id: COMMANDE, acheteurId: ACHETEUR_C, statut: 'en_attente', statutPaiement: 'non_paye', montantTotal: 25000 });
    mockCommandeFindOne.mockResolvedValue(commandeDeCEtA());

    await CommandeService.creerCommande({
      acheteurId: ACHETEUR_C,
      items: [{ produitId: 'p-a', quantite: 2, prix: 1, prixUnitaire: 1, sousTotal: 1 }],
      modeLivraison: 'retrait',
      modePaiement: 'a_la_livraison',
      numeroTelephone: '+221771234567',
      montantTotal: 1,
      montantProduits: 1,
      fraisLivraison: -99999,
    }).catch(() => {});

    expect(mockCommandeCreate).toHaveBeenCalled();
    const ecrit = mockCommandeCreate.mock.calls[0][0];
    // 2 × 25 000 relus en base, et non le 1 FCFA annoncé par le client.
    expect(ecrit.montantProduits).toBe(50000);
    expect(ecrit.montantTotal).toBe(50000);
  });

  it('le prix soldé est appliqué quand il est inférieur — annoncer un prix et en encaisser un autre serait pire', async () => {
    mockProduitFindAll.mockResolvedValue([{ ...produit(), prix: '25000', prix_promo: '18000' }]);
    mockCommandeCreate.mockResolvedValue({ id: COMMANDE, statut: 'en_attente', statutPaiement: 'non_paye' });
    mockCommandeFindOne.mockResolvedValue(commandeDeCEtA());

    await CommandeService.creerCommande({
      acheteurId: ACHETEUR_C,
      items: [{ produitId: 'p-a', quantite: 1 }],
      modeLivraison: 'retrait',
      modePaiement: 'a_la_livraison',
      numeroTelephone: '+221771234567',
    }).catch(() => {});

    const ecrit = mockCommandeCreate.mock.calls[0][0];
    expect(ecrit.montantProduits).toBe(18000);
  });

  it('un statut de paiement envoyé par le client est ignoré', async () => {
    mockProduitFindAll.mockResolvedValue([produit()]);
    mockCommandeCreate.mockResolvedValue({ id: COMMANDE, statut: 'en_attente', statutPaiement: 'non_paye' });
    mockCommandeFindOne.mockResolvedValue(commandeDeCEtA());

    await CommandeService.creerCommande({
      acheteurId: ACHETEUR_C,
      items: [{ produitId: 'p-a', quantite: 1 }],
      modeLivraison: 'retrait',
      modePaiement: 'a_la_livraison',
      numeroTelephone: '+221771234567',
      statutPaiement: 'paye',   // « c'est déjà payé »
      statut: 'livree',         // « et déjà livré »
    }).catch(() => {});

    const ecrit = mockCommandeCreate.mock.calls[0][0];
    expect(ecrit.statutPaiement).toBe('non_paye');
    expect(ecrit.statut).toBe('en_attente');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  D-21 — le verrouillage de ligne sur le stock
// ═══════════════════════════════════════════════════════════════════════════

describe('D-21 — le stock est lu sous verrou', () => {
  it('les produits sont verrouillés, et dans un ordre stable', async () => {
    mockProduitFindAll.mockResolvedValue([]);

    await CommandeService.creerCommande({
      acheteurId: ACHETEUR_C,
      items: [{ produitId: 'p-b', quantite: 1 }, { produitId: 'p-a', quantite: 1 }],
      modeLivraison: 'retrait',
      modePaiement: 'a_la_livraison',
      numeroTelephone: '+221771234567',
    }).catch(() => {});

    const options = mockProduitFindAll.mock.calls[0][0];
    // `SELECT … FOR UPDATE` : deux commandes simultanées sur le dernier
    // article se voient, au lieu de passer toutes les deux.
    expect(options.lock).toBe('UPDATE');
    // Tri par identifiant : deux commandes qui verrouillent les mêmes
    // produits dans un ordre différent s'interbloqueraient.
    expect(options.order).toEqual([['id', 'ASC']]);
  });

  it('un même produit sur deux lignes est cumulé avant le contrôle de stock', async () => {
    // Stock de 3, demandé 2 + 2 : refusé. Ligne par ligne, chacune passait.
    mockProduitFindAll.mockResolvedValue([
      { id: 'p-a', nom: 'Sac', vendeurId: VENDEUR_A, disponible: true, quantite: 3, prix: '10000', prix_promo: null },
    ]);

    await expect(
      CommandeService.creerCommande({
        acheteurId: ACHETEUR_C,
        items: [{ produitId: 'p-a', quantite: 2 }, { produitId: 'p-a', quantite: 2 }],
        modeLivraison: 'retrait',
        modePaiement: 'a_la_livraison',
        numeroTelephone: '+221771234567',
      }),
    ).rejects.toThrow(/stock insuffisant/i);

    expect(mockCommandeCreate).not.toHaveBeenCalled();
  });
});
