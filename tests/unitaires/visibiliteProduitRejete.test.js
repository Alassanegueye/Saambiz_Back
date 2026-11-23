/**
 * UN PRODUIT REJETÉ PAR LA MODÉRATION DOIT DISPARAÎTRE — ce n'est pas le cas.
 *
 * Défaut H-01 de l'audit du 23 novembre 2026, le plus grave trouvé.
 *
 * `AdminService.rejeterProduit` écrit `statut: 'rejete'` et ne touche pas à
 * `disponible` (admin.service.js:267). Or sur toute la surface héritée
 * `/acheteurs/*` — les douze méthodes de `acheteurs.service.js` qui lisent
 * `Produit`, sans exception — le filtre de visibilité ne regarde jamais
 * `statut`. Et la création de commande non plus : `commande.service.js:298`
 * contrôle `produit.disponible`, jamais `produit.statut`.
 *
 * Conséquence : l'administrateur retire un produit, le vendeur reçoit
 * « n'est plus proposé aux clients » (admin.service.js:274), et le produit
 * reste listé, consultable et COMMANDABLE depuis l'application mobile.
 * Personne ne s'en aperçoit.
 *
 * Ce n'est pas une fuite entre boutiques : c'est le contournement d'un
 * contrôle d'administration. Pour une place de marché, un produit contrefait
 * ou illicite retiré reste en vente.
 *
 * ── POURQUOI CES TESTS SONT EN `test.failing` ──────────────────────────────
 *
 * Ils décrivent le comportement ATTENDU, qui n'est pas celui du code. Marqués
 * `failing`, ils passent tant que le défaut est là et deviennent rouges le
 * jour où il est corrigé — ce qui est le signal pour les repasser en `test`.
 * La suite reste donc verte sans que le défaut soit dissimulé.
 *
 * Le correctif touche `acheteurs.service.js` et `commande.service.js`, deux
 * services du PÉRIMÈTRE MOBILE. L'utilisateur a demandé de ne pas modifier
 * les API consommées par les applications publiées : la correction attend sa
 * décision. Voir la section 9 du rapport.
 */

const mockProduitFindByPk = jest.fn();
const mockProduitFindAll = jest.fn();
const mockBoutiqueFindByPk = jest.fn();

const mockModeleFactice = () => ({
  findOne: jest.fn(), findAll: jest.fn(), findByPk: jest.fn(),
  create: jest.fn(), update: jest.fn(), destroy: jest.fn(), count: jest.fn(),
  belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(),
  belongsToMany: jest.fn(), addHook: jest.fn(), sync: jest.fn(),
});

jest.mock('../../src/config/db', () => ({
  define: () => mockModeleFactice(),
  transaction: async () => ({ commit: jest.fn(), rollback: jest.fn(), LOCK: { UPDATE: 'UPDATE' } }),
  query: jest.fn(),
  fn: (...a) => ({ fn: a }),
  col: (...a) => ({ col: a }),
  literal: (...a) => ({ literal: a }),
  authenticate: jest.fn(),
  QueryTypes: { SELECT: 'SELECT' },
}));

jest.mock('../../src/models', () => ({
  Produit: {
    findByPk: (...a) => mockProduitFindByPk(...a),
    findAll: (...a) => mockProduitFindAll(...a),
    findAndCountAll: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    increment: jest.fn(),
  },
  Boutique: { findByPk: (...a) => mockBoutiqueFindByPk(...a), findOne: jest.fn(), findAll: jest.fn() },
  Categorie: { findAll: jest.fn(), findByPk: jest.fn() },
  Utilisateur: { findByPk: jest.fn(), findOne: jest.fn(), findAll: jest.fn() },
  Abonnement: { findOne: jest.fn(), findAll: jest.fn() },
  Favori: { findAll: jest.fn(), findOne: jest.fn(), count: jest.fn() },
  Promotion: { findAll: jest.fn(), findOne: jest.fn() },
  Message: { findAll: jest.fn(), count: jest.fn() },
  Notification: { count: jest.fn(), findAll: jest.fn() },
  ProduitImage: { findAll: jest.fn(), findOne: jest.fn(), count: jest.fn() },
  Commande: { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn(), count: jest.fn(), sum: jest.fn() },
  LigneCommande: { findAll: jest.fn(), bulkCreate: jest.fn() },
  HistoriqueCommande: { create: jest.fn() },
  Paiement: { findAll: jest.fn(), count: jest.fn(), sum: jest.fn() },
  Signalement: { findAll: jest.fn(), findByPk: jest.fn(), count: jest.fn() },
}));

// `AdminService._prevenir` enchaîne un `.catch` sur le retour de
// `creerNotification` : les doublures rendent donc des promesses, sinon la
// suite échoue sur « Cannot read properties of undefined (reading 'catch') »
// — un échec de doublure, pas un défaut du code.
jest.mock('../../src/services/notifications/notification.service', () => ({
  notifierUtilisateur: jest.fn(async () => undefined),
  notifierUtilisateurs: jest.fn(async () => undefined),
  notifierAbonnesDuVendeur: jest.fn(async () => undefined),
  creerNotification: jest.fn(async () => undefined),
}));

const AcheteurService = require('../../src/services/acheteurs/acheteurs.service');

const PRODUIT_REJETE = 'dddddddd-0000-4000-8000-00000000000d';
const BOUTIQUE = 'eeeeeeee-0000-4000-8000-00000000000e';

beforeEach(() => {
  mockProduitFindByPk.mockReset();
  mockProduitFindAll.mockReset();
  mockBoutiqueFindByPk.mockReset();
});

// ═══════════════════════════════════════════════════════════════════════════
//  H-01 (a) — le correctif appliqué : le rejet retire le produit de la vente
// ═══════════════════════════════════════════════════════════════════════════

describe('H-01 (a) — rejeterProduit retire le produit de la vente', () => {
  const AdminService = require('../../src/services/admin/admin.service');

  it('écrit `disponible: false` en même temps que le statut', async () => {
    const produit = {
      id: PRODUIT_REJETE,
      nom: 'Montre contrefaite',
      vendeurId: 'ffffffff-0000-4000-8000-00000000000f',
      statut: 'approuve',
      disponible: true,
      update: jest.fn(),
    };
    mockProduitFindByPk.mockResolvedValue(produit);

    await AdminService.rejeterProduit(PRODUIT_REJETE);

    // Le statut SEUL ne retirait rien : aucune route `/acheteurs/*` ne le
    // consulte, et la création de commande non plus — elle ne regarde que
    // `disponible`. C'est donc cette seconde colonne qui bloque la vente.
    expect(produit.update).toHaveBeenCalledWith(
      expect.objectContaining({ statut: 'rejete', disponible: false }),
    );
  });

  it('approuver un produit ne le remet pas en vente de force', async () => {
    // Symétrie à NE PAS faire : l'interrupteur « En ligne » appartient au
    // vendeur. L'approbation lève l'interdiction de modération, elle ne
    // décide pas à sa place de publier.
    const produit = {
      id: PRODUIT_REJETE, nom: 'Sac', vendeurId: 'v1',
      statut: 'rejete', disponible: false, update: jest.fn(),
    };
    mockProduitFindByPk.mockResolvedValue(produit);

    await AdminService.approuverProduit(PRODUIT_REJETE);

    const ecrits = produit.update.mock.calls[0][0];
    expect(ecrits.statut).toBe('approuve');
    expect(ecrits).not.toHaveProperty('disponible');
  });

  it.failing('un produit rejeté ne redevient pas disponible au retour de stock', async () => {
    // LIMITE CONNUE du correctif (a). `_restituerStock` remet
    // `disponible = true` dès que la quantité repasse au-dessus de zéro,
    // SANS regarder `statut` (commande.service.js). Annuler une commande qui
    // portait un produit entre-temps rejeté le remet donc en vente.
    //
    // Le correctif est d'une ligne — `&& produit.statut === 'approuve'` —
    // mais il est dans `commande.service.js`, un service du périmètre
    // mobile : il attend l'accord de l'utilisateur.
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '../../src/services/commandes/commande.service.js'),
      'utf8',
    );
    expect(source).toMatch(/produit\.quantite > 0 && produit\.statut === 'approuve'/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Ce qui est DÉJÀ correct : les surfaces récentes filtrent bien
// ═══════════════════════════════════════════════════════════════════════════

describe('Le filtre de visibilité EST appliqué sur les surfaces récentes', () => {
  it('le catalogue public exige statut: approuve', () => {
    // Preuve par le code : `catalogue.service.js` pose le filtre dès la base
    // de sa clause `where`, à quatre endroits distincts.
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../src/services/catalogue/catalogue.service.js'),
      'utf8',
    );
    expect(src).toContain("statut: 'approuve'");
    // Et il le pose sur la fiche produit, pas seulement sur la liste.
    expect(src).toMatch(/where:\s*\{\s*id,\s*statut:\s*'approuve'/);
  });

  it('la vitrine d\'une boutique exige statut: approuve', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../src/services/vitrine/vitrine.service.js'),
      'utf8',
    );
    expect(src).toContain("statut: 'approuve'");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  T-22 — le défaut : la surface héritée ne filtre rien
// ═══════════════════════════════════════════════════════════════════════════

describe('T-22 — un produit rejeté ne doit plus être visible', () => {
  it.failing('la fiche produit refuse un produit rejeté', async () => {
    // La base renvoie le produit : c'est au service de ne pas le servir.
    mockProduitFindByPk.mockResolvedValue({
      id: PRODUIT_REJETE,
      nom: 'Montre contrefaite',
      statut: 'rejete',
      disponible: true,
    });

    // Attendu : soit un refus, soit une requête qui exclut `rejete`.
    // Constaté aujourd'hui : le produit est renvoyé tel quel.
    await expect(AcheteurService.getDetailProduit(PRODUIT_REJETE)).rejects.toThrow();
  });

  it.failing('la fiche produit borne au moins sa requête sur le statut', async () => {
    mockProduitFindByPk.mockResolvedValue({ id: PRODUIT_REJETE, statut: 'rejete' });

    await AcheteurService.getDetailProduit(PRODUIT_REJETE).catch(() => {});

    // `findByPk(id, options)` : le second argument devrait porter le filtre.
    const options = mockProduitFindByPk.mock.calls[0][1] || {};
    expect(options.where).toEqual(
      expect.objectContaining({ statut: 'approuve' }),
    );
  });

  it.failing('le détail d\'une boutique n\'inclut pas ses produits rejetés', async () => {
    mockBoutiqueFindByPk.mockResolvedValue({
      id: BOUTIQUE,
      favoris: [],
      produits: [],
      get: () => ({}),
    });

    await AcheteurService.getDetailBoutique(BOUTIQUE).catch(() => {});

    // L'inclusion des produits filtre `disponible: true` mais jamais
    // `statut` : un produit rejeté et disponible remonte donc.
    const options = mockBoutiqueFindByPk.mock.calls[0][1];
    const inclusionProduits = options.include.find(
      (i) => i.as === 'produits',
    );
    expect(inclusionProduits.where).toEqual(
      expect.objectContaining({ statut: 'approuve' }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  T-22 (suite) — la conséquence la plus coûteuse : il reste commandable
// ═══════════════════════════════════════════════════════════════════════════

describe('T-22 — un produit rejeté ne doit pas être commandable', () => {
  /**
   * L'assertion porte sur UN SEUL fait, observable sans traverser tout le
   * chemin de création : `Commande.create` a-t-il été appelé ?
   *
   * C'est volontaire. Une première version de ce test attendait une erreur
   * précise, et elle échouait bien — mais sur « Cannot read properties of
   * undefined », un artefact de ma propre doublure, pas sur le défaut. Un
   * test marqué `failing` qui échoue pour la mauvaise raison ne prouve rien
   * et passerait au vert sans que le défaut soit corrigé.
   */
  it.failing('la création de commande refuse un produit rejeté', async () => {
    const CommandeService = require('../../src/services/commandes/commande.service');
    const { Commande } = require('../../src/models');

    // Le verrouillage renvoie le produit rejeté mais encore « disponible » :
    // c'est exactement l'état que laisse `rejeterProduit`.
    mockProduitFindAll.mockResolvedValue([
      {
        id: PRODUIT_REJETE,
        nom: 'Montre contrefaite',
        statut: 'rejete',
        disponible: true,
        quantite: 10,
        prix: '25000',
        prix_promo: null,
        vendeurId: 'ffffffff-0000-4000-8000-00000000000f',
      },
    ]);
    Commande.create.mockClear();

    await CommandeService.creerCommande({
      acheteurId: 'cccccccc-0000-4000-8000-00000000000c',
      items: [{ produitId: PRODUIT_REJETE, quantite: 1 }],
      modeLivraison: 'retrait',
      modePaiement: 'a_la_livraison',
      numeroTelephone: '+221771234567',
    }).catch(() => {
      // Le chemin d'après la validation importe peu ici : seule compte la
      // question de savoir si la validation a laissé passer le produit.
    });

    // Attendu : la validation refuse, donc aucune commande n'est créée.
    // Constaté : `commande.service.js:298` ne regarde que `disponible`, la
    // commande est créée et le produit retiré par la modération est vendu.
    expect(Commande.create).not.toHaveBeenCalled();
  });
});
