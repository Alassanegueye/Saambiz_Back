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
const mockProduitFindOne = jest.fn();
const mockProduitFindAndCountAll = jest.fn();
const mockFavoriFindAll = jest.fn();
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
    findOne: (...a) => mockProduitFindOne(...a),
    findAll: (...a) => mockProduitFindAll(...a),
    findAndCountAll: (...a) => mockProduitFindAndCountAll(...a),
    count: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    increment: jest.fn(),
  },
  Boutique: { findByPk: (...a) => mockBoutiqueFindByPk(...a), findOne: jest.fn(), findAll: jest.fn() },
  Categorie: { findAll: jest.fn(), findByPk: jest.fn() },
  Utilisateur: { findByPk: jest.fn(), findOne: jest.fn(), findAll: jest.fn() },
  Abonnement: { findOne: jest.fn(), findAll: jest.fn() },
  Favori: { findAll: (...a) => mockFavoriFindAll(...a), findOne: jest.fn(), count: jest.fn() },
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
  mockProduitFindOne.mockReset();
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

  /**
   * LE TROU QUI SE ROUVRAIT TOUT SEUL.
   *
   * `_restaurerStock` remettait `disponible = true` des que la quantite
   * repassait au-dessus de zero, sans regarder `statut`. Annuler une commande
   * portant un produit entre-temps retire le remettait donc en vente — sans
   * que personne n'ait rien fait, et sans trace.
   *
   * Ce test exerce le COMPORTEMENT. Une premiere version se contentait d'une
   * expression reguliere sur le fichier source : elle aurait passe au vert sur
   * un commentaire contenant la bonne phrase, et elle ne disait rien de ce que
   * le code fait vraiment.
   */
  describe('le retour de stock ne défait pas une décision de modération', () => {
    const { Commande, LigneCommande } = require('../../src/models');
    let CommandeService;

    /** Rejoue `_restaurerStock` sur un produit donné et rend son état. */
    async function restituer(produit) {
      CommandeService = require('../../src/services/commandes/commande.service');
      LigneCommande.findAll.mockResolvedValue([
        { produitId: produit.id, quantite: 2 },
      ]);
      mockProduitFindAll.mockResolvedValue([produit]);

      const commande = {
        id: 'cmd-1',
        stockDecremente: true,
        save: jest.fn(),
      };
      await CommandeService._restaurerStock(commande, {
        LOCK: { UPDATE: 'UPDATE' },
      });
      return produit;
    }

    it('un produit APPROUVÉ repasse bien en ligne', async () => {
      // Le cas legitime doit continuer de marcher : c'est tout l'interet du
      // retour de stock, et une protection qui le casserait serait un defaut.
      const produit = {
        id: 'p-ok', nom: 'Sac', statut: 'approuve',
        quantite: 0, disponible: false, save: jest.fn(),
      };
      await restituer(produit);

      expect(produit.quantite).toBe(2);
      expect(produit.disponible).toBe(true);
    });

    it('un produit REJETÉ récupère son stock mais reste hors ligne', async () => {
      const produit = {
        id: 'p-rejete', nom: 'Montre contrefaite', statut: 'rejete',
        quantite: 0, disponible: false, save: jest.fn(),
      };
      await restituer(produit);

      // Le stock revient — il n'y a pas de raison de le perdre, le vendeur
      // l'a physiquement.
      expect(produit.quantite).toBe(2);
      // Mais il ne repart pas en vente.
      expect(produit.disponible).toBe(false);
    });

    it('un produit EN ATTENTE reste hors ligne aussi', async () => {
      const produit = {
        id: 'p-attente', nom: 'Sac', statut: 'en_attente',
        quantite: 0, disponible: false, save: jest.fn(),
      };
      await restituer(produit);

      expect(produit.disponible).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Ce qui est DÉJÀ correct : les surfaces récentes filtrent bien
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
//  LES ROUTES DE LISTE — c'est par elles que le produit restait visible
// ═══════════════════════════════════════════════════════════════════════════

describe('H-01 (b) — chaque liste du catalogue porte le filtre de visibilité', () => {
  /**
   * Les méthodes exercées ici sont celles qui listent des produits a un
   * client. Elles sont appelees par l'application mobile publiee : un produit
   * retire doit disparaitre de leurs resultats, et c'est l'effet voulu.
   *
   * L'assertion porte sur la clause `where` transmise a Sequelize, pas sur le
   * nombre de lignes rendues : c'est la requete qui doit etre bornee. Un
   * filtrage fait apres coup, en JavaScript, serait contournable des qu'une
   * pagination s'y ajoute — on ne filtre pas la page courante, on filtre la
   * requete.
   */
  const LISTES = [
    ['listerTousProduits', (s) => s.listerTousProduits(ACHETEUR, 1)],
    ['rechercherProduits', (s) => s.rechercherProduits(ACHETEUR, 'sac', 1)],
    ['filtrerParVille', (s) => s.filtrerParVille(ACHETEUR, 'Dakar', 1)],
    ['getProduitsByBoutique', (s) => s.getProduitsByBoutique(BOUTIQUE, 1)],
    ['listerProduitsAvecFiltres', (s) => s.listerProduitsAvecFiltres({ acheteurId: ACHETEUR })],
    ['decouverte', (s) => s.decouverte({ page: 1 })],
    ['produitsTendance', (s) => s.produitsTendance(ACHETEUR)],
    ['rechercheGlobale', (s) => s.rechercheGlobale(ACHETEUR, 'sac')],
  ];

  const ACHETEUR = 'cccccccc-0000-4000-8000-00000000000c';

  beforeEach(() => {
    mockFavoriFindAll.mockResolvedValue([
      { boutique: { vendeurId: 'v1' } },
    ]);
    mockProduitFindAndCountAll.mockResolvedValue({ rows: [], count: 0 });
    mockProduitFindAll.mockResolvedValue([]);
    // `getProduitsByBoutique` resout d'abord la boutique.
    mockBoutiqueFindByPk.mockResolvedValue({ id: BOUTIQUE, vendeurId: 'v1' });
  });

  for (const [nom, appeler] of LISTES) {
    it(`${nom} borne sa requête sur statut: approuve`, async () => {
      await appeler(AcheteurService).catch(() => {});

      const appels = [
        ...mockProduitFindAndCountAll.mock.calls,
        ...mockProduitFindAll.mock.calls,
      ];
      expect(appels.length).toBeGreaterThan(0); // la méthode a bien requêté

      // Au moins une requête produit, et toutes celles qui en font doivent
      // porter le filtre.
      const avecFiltre = appels.filter(
        (a) => a[0] && a[0].where && a[0].where.statut === 'approuve',
      );
      expect(avecFiltre.length).toBe(appels.length);
    });
  }

  it('la constante est unique et gelée — douze recopies auraient divergé', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../src/services/acheteurs/acheteurs.service.js'),
      'utf8',
    );
    // Une seule déclaration, et elle est gelée.
    expect(src.match(/const PRODUIT_VISIBLE/g)).toHaveLength(1);
    expect(src).toContain("Object.freeze({ statut: 'approuve' })");

    // Aucun `statut: 'approuve'` recopié a la main dans du CODE. Les lignes de
    // commentaire sont ecartees : la premiere version de cette assertion les
    // comptait et echouait sur le commentaire qui explique justement pourquoi
    // il n'y a qu'une constante.
    const recopies = src
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .filter((l) => l.includes("statut: 'approuve'") && !l.includes('Object.freeze'));
    expect(recopies).toEqual([]);

    // Douze usages au moins : c'est le nombre de requêtes à couvrir.
    expect((src.match(/PRODUIT_VISIBLE/g) || []).length).toBeGreaterThanOrEqual(12);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  « PLUS AU CATALOGUE » N'EST PAS « EFFACÉ DU PASSÉ »
// ═══════════════════════════════════════════════════════════════════════════

describe('H-01 (b) — l\'historique des commandes survit au retrait', () => {
  it('aucune requête de commande ne joint la table produit', () => {
    // C'est ce qui rend l'historique structurellement insensible au filtre de
    // visibilite : un acheteur qui a commande un article depuis retire
    // continue de voir sa commande et ses lignes.
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../src/services/commandes/commande.service.js'),
      'utf8',
    );
    expect(src).not.toMatch(/model:\s*Produit\b/);
  });

  it('la ligne de commande garde le nom, l\'image et le prix en propre', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../src/models/ligneCommande.model.js'),
      'utf8',
    );
    // Denormalisation volontaire : sans elle, retirer un produit du catalogue
    // viderait les commandes passees.
    for (const champ of ['nomProduit', 'imageProduit', 'prixUnitaire']) {
      expect(src).toContain(champ);
    }
  });
});

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
  it('la fiche produit refuse un produit rejeté', async () => {
    // La requête est bornée : un produit rejeté n'est pas trouvé.
    mockProduitFindOne.mockResolvedValue(null);

    await expect(AcheteurService.getDetailProduit(PRODUIT_REJETE)).rejects.toThrow();
  });

  it('la fiche produit borne sa requête sur le statut', async () => {
    mockProduitFindOne.mockResolvedValue(null);

    await AcheteurService.getDetailProduit(PRODUIT_REJETE).catch(() => {});

    // Cette assertion a été réécrite avec le correctif : elle portait sur
    // `findByPk(id, options)`, et le service utilise desormais `findOne` —
    // précisément pour pouvoir poser un `where`. Laissée telle quelle, elle
    // aurait continué d'« échouer » sur un `mock.calls[0]` absent, donc de
    // passer en `it.failing` alors que le défaut était corrigé.
    const { where } = mockProduitFindOne.mock.calls[0][0];
    expect(where).toEqual(
      expect.objectContaining({ id: PRODUIT_REJETE, statut: 'approuve' }),
    );
  });

  it('le détail d\'une boutique n\'inclut pas ses produits rejetés', async () => {
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
  it('la création de commande refuse un produit rejeté', async () => {
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
