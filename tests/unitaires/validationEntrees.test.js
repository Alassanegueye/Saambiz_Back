/**
 * VALIDATION DES ENTRÉES — avant la requête SQL, pas après.
 *
 * Ce fichier retient les trois endroits où une donnée venue du client touche
 * de près la structure d'une requête, et où une régression serait grave :
 *
 *   1. LES COORDONNÉES GPS. `boutiquesProches` les interpole directement dans
 *      du SQL brut via `Sequelize.literal` — c'est le seul endroit du dépôt
 *      où une valeur du client entre dans la structure d'une requête. La
 *      protection n'est pas une liste blanche mais une conversion :
 *      `parseFloat` puis bornes. Une valeur interpolée est donc toujours un
 *      NOMBRE JavaScript, jamais une chaîne. C'est solide, et c'est
 *      exactement le genre de garde qu'un remaniement « pour accepter aussi
 *      les chaînes » ferait sauter.
 *
 *   2. LE TRI. `TRIS[f.tri]` est une correspondance par table, donc une
 *      liste blanche — mais la recherche traverse la chaîne de prototypes :
 *      `TRIS['constructor']` rend la fonction `Object`, qui est VRAIE, donc
 *      le repli ne joue pas (défaut L-05). Documenté ici en `test.failing`.
 *
 *   3. LES FICHIERS. Le type est déterminé par les octets de tête, pas par
 *      le `Content-Type` annoncé par le client.
 *
 * Couvre les contrôles D-03, D-13, D-14, A-27, A-28 et L-05 du rapport.
 */

const mockProduitFindAndCountAll = jest.fn();
const mockBoutiqueFindAll = jest.fn();

const mockModeleFactice = () => ({
  findOne: jest.fn(), findAll: jest.fn(), findByPk: jest.fn(),
  create: jest.fn(), update: jest.fn(), destroy: jest.fn(), count: jest.fn(),
  belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(),
  belongsToMany: jest.fn(), addHook: jest.fn(), sync: jest.fn(),
});

jest.mock('../../src/config/db', () => ({
  define: () => mockModeleFactice(),
  transaction: async (rappel) => {
    const t = { commit: jest.fn(), rollback: jest.fn(), LOCK: { UPDATE: 'UPDATE' } };
    if (typeof rappel === 'function') return rappel(t);
    return t;
  },
  query: jest.fn(),
  fn: (...a) => ({ fn: a }), col: (...a) => ({ col: a }), literal: (...a) => ({ literal: a }),
  authenticate: jest.fn(),
  QueryTypes: { SELECT: 'SELECT' },
}));

jest.mock('../../src/models', () => ({
  Produit: {
    findAndCountAll: (...a) => mockProduitFindAndCountAll(...a),
    findAll: jest.fn(), findByPk: jest.fn(), findOne: jest.fn(),
    count: jest.fn(), update: jest.fn(), increment: jest.fn(),
  },
  Boutique: {
    findAll: (...a) => mockBoutiqueFindAll(...a),
    findByPk: jest.fn(), findOne: jest.fn(), count: jest.fn(),
  },
  Categorie: { findAll: jest.fn(), findByPk: jest.fn(), findOne: jest.fn() },
  Utilisateur: { findByPk: jest.fn(), findOne: jest.fn(), findAll: jest.fn() },
  Abonnement: { findOne: jest.fn(), findAll: jest.fn() },
  Favori: { findAll: jest.fn(), findOne: jest.fn(), count: jest.fn() },
  Promotion: { findAll: jest.fn(), findOne: jest.fn() },
  Message: { findAll: jest.fn(), count: jest.fn() },
  Notification: { count: jest.fn(), findAll: jest.fn() },
  ProduitImage: { findAll: jest.fn(), count: jest.fn() },
  Avis: { findAll: jest.fn(), findOne: jest.fn() },
  BoutiqueCategorie: { findAll: jest.fn() },
}));

jest.mock('../../src/services/notifications/notification.service', () => ({
  notifierUtilisateur: jest.fn(),
  notifierUtilisateurs: jest.fn(),
  notifierAbonnesDuVendeur: jest.fn(),
  creerNotification: jest.fn(),
}));

// ═══════════════════════════════════════════════════════════════════════════
//  T-08 — coordonnées GPS interpolées dans du SQL brut
// ═══════════════════════════════════════════════════════════════════════════

describe('T-08 — boutiquesProches : la seule interpolation de SQL brut du dépôt', () => {
  const AcheteurService = require('../../src/services/acheteurs/acheteurs.service');

  /**
   * Deux familles de charges, et la distinction est le vrai sujet.
   *
   * Une première version de ce test attendait un REFUS pour toutes. C'était
   * faux, et la correction est instructive : `parseFloat('14.7; DROP TABLE')`
   * vaut 14.7. La charge est donc acceptée — mais ce qui est interpolé est le
   * NOMBRE 14.7, la suite ayant été jetée par la conversion. Il n'y a pas
   * d'injection, et il n'y en a pas parce que le code convertit au lieu de
   * filtrer. Un filtre par expression régulière, lui, se contourne.
   */
  const CHARGES_REFUSEES = [
    "'; DELETE FROM produit WHERE 1=1; --",  // ne commence pas par un nombre
    "' OR '1'='1",
    'null',
    'undefined',
    '[]',
    '{}',
    'NaN',
    '',
    '   ',
  ];

  const CHARGES_TRONQUEES = [
    '14.7; DROP TABLE utilisateur; --',
    "14.7' OR '1'='1",
    '14.7) UNION SELECT mot_de_passe FROM utilisateur --',
    '14.7 OR 1=1',
  ];

  beforeEach(() => {
    mockBoutiqueFindAll.mockReset().mockResolvedValue([]);
  });

  for (const charge of CHARGES_REFUSEES) {
    it(`refuse ${JSON.stringify(charge)} sans atteindre la base`, async () => {
      await expect(
        AcheteurService.boutiquesProches(charge, charge, 5),
      ).rejects.toThrow(/invalide/i);

      // Le refus arrive AVANT toute requête : la charge n'est jamais
      // interpolée, même dans une requête qui échouerait ensuite.
      expect(mockBoutiqueFindAll).not.toHaveBeenCalled();
    });
  }

  for (const charge of CHARGES_TRONQUEES) {
    it(`tronque ${JSON.stringify(charge)} en nombre, et n'interpole que lui`, async () => {
      await AcheteurService.boutiquesProches(charge, '-17.4441', 10);

      expect(mockBoutiqueFindAll).toHaveBeenCalled();
      // Tout ce qui part vers Sequelize, littéraux compris. Les clés Symbol
      // de Sequelize échappent à JSON.stringify : on inspecte donc aussi
      // les littéraux un par un, sinon l'assertion serait vide.
      const options = mockBoutiqueFindAll.mock.calls[0][0];
      const tout = [
        JSON.stringify(options),
        JSON.stringify(options.attributes || {}),
        JSON.stringify(options.having || {}),
        JSON.stringify(options.order || []),
      ].join(' ');

      for (const mot of ['DROP', 'DELETE', 'UNION', 'SELECT', '--', "'"]) {
        expect(tout).not.toContain(mot);
      }
      // Et le nombre, lui, est bien là.
      expect(tout).toContain('14.7');
    });
  }

  it('refuse Infinity et -Infinity', async () => {
    for (const valeur of ['Infinity', '-Infinity', Infinity, -Infinity]) {
      await expect(
        AcheteurService.boutiquesProches(valeur, 14.7, 5),
      ).rejects.toThrow(/invalide/i);
    }
    expect(mockBoutiqueFindAll).not.toHaveBeenCalled();
  });

  it('refuse des coordonnées hors bornes terrestres', async () => {
    // 91° de latitude n'existe pas : accepter la valeur reviendrait à
    // accepter n'importe quel nombre, et la borne est précisément ce qui
    // garantit qu'on interpole un nombre « raisonnable ».
    await expect(AcheteurService.boutiquesProches(91, 14.7, 5)).rejects.toThrow(/invalide/i);
    await expect(AcheteurService.boutiquesProches(-91, 14.7, 5)).rejects.toThrow(/invalide/i);
    await expect(AcheteurService.boutiquesProches(14.7, 181, 5)).rejects.toThrow(/invalide/i);
    await expect(AcheteurService.boutiquesProches(14.7, -181, 5)).rejects.toThrow(/invalide/i);
  });

  it('refuse un rayon nul, négatif ou démesuré', async () => {
    for (const rayon of [0, -1, 501, 99999]) {
      await expect(
        AcheteurService.boutiquesProches(14.7, -17.4, rayon),
      ).rejects.toThrow(/invalide/i);
    }
  });

  it('accepte Dakar, et n\'interpole que des NOMBRES', async () => {
    // Dakar : 14.6937 N, -17.4441 W.
    await AcheteurService.boutiquesProches('14.6937', '-17.4441', '10');

    expect(mockBoutiqueFindAll).toHaveBeenCalled();
    // Le littéral construit est inspecté : il ne doit contenir aucune
    // apostrophe, aucun point-virgule, aucun mot-clé SQL venu du client.
    const options = mockBoutiqueFindAll.mock.calls[0][0];
    const litteraux = JSON.stringify(options);
    expect(litteraux).not.toMatch(/DROP|DELETE|UNION|--/i);
  });

  it('une valeur numériquement correcte mais suffixée est tronquée par parseFloat, et bornée', async () => {
    // `parseFloat('14.7abc')` vaut 14.7 : la suite est jetée. C'est la
    // conversion, pas un filtre, qui ferme l'injection — et elle la ferme
    // complètement, puisque ce qui est interpolé est le nombre obtenu.
    await AcheteurService.boutiquesProches('14.6937; DROP TABLE', '-17.4441', '10');

    expect(mockBoutiqueFindAll).toHaveBeenCalled();
    const litteraux = JSON.stringify(mockBoutiqueFindAll.mock.calls[0][0]);
    expect(litteraux).not.toMatch(/DROP/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  T-12 / A-28 — tri, recherche et pagination
// ═══════════════════════════════════════════════════════════════════════════

describe('T-12 — tri, recherche et pagination du catalogue', () => {
  const CatalogueService = require('../../src/services/catalogue/catalogue.service');

  beforeEach(() => {
    mockProduitFindAndCountAll.mockReset().mockResolvedValue({ rows: [], count: 0 });
  });

  it('un tri inconnu retombe sur le tri par défaut', async () => {
    await CatalogueService.lister({ tri: 'nimporte_quoi' });

    const { order } = mockProduitFindAndCountAll.mock.calls[0][0];
    expect(Array.isArray(order)).toBe(true);
    expect(order[0][0]).toBe('createdAt');
  });

  it('tri=constructor retombe aussi sur le tri par défaut (L-05)', async () => {
    await CatalogueService.lister({ tri: 'constructor' });

    const { order } = mockProduitFindAndCountAll.mock.calls[0][0];
    // `TRIS['constructor']` rend la fonction `Object`, qui est vraie : le
    // repli `|| TRIS.recents` ne joue donc pas, et c'est une FONCTION qui
    // part comme clause `order` vers Sequelize.
    // Correctif : `Object.hasOwn(TRIS, f.tri) ? TRIS[f.tri] : défaut`.
    expect(Array.isArray(order)).toBe(true);
  });

  it('tri=__proto__ retombe aussi sur le tri par défaut (L-05)', async () => {
    await CatalogueService.lister({ tri: '__proto__' });

    const { order } = mockProduitFindAndCountAll.mock.calls[0][0];
    expect(Array.isArray(order)).toBe(true);
  });

  it('les tris légitimes fonctionnent toujours', async () => {
    for (const tri of ['recents', 'populaires', 'prix_asc', 'prix_desc']) {
      mockProduitFindAndCountAll.mockClear();
      await CatalogueService.lister({ tri });
      const { order } = mockProduitFindAndCountAll.mock.calls[0][0];
      // Une correction du repli ne doit pas casser les tris réels.
      expect(Array.isArray(order)).toBe(true);
      expect(order.length).toBeGreaterThan(0);
    }
  });

  it('la taille de page est plafonnée côté serveur', async () => {
    await CatalogueService.lister({ limit: 100000 });
    expect(mockProduitFindAndCountAll.mock.calls[0][0].limit).toBeLessThanOrEqual(50);

    mockProduitFindAndCountAll.mockClear();
    await CatalogueService.lister({ limit: -5 });
    expect(mockProduitFindAndCountAll.mock.calls[0][0].limit).toBeGreaterThanOrEqual(1);
  });

  it('une page négative ne produit pas un décalage négatif', async () => {
    await CatalogueService.lister({ page: -10 });
    expect(mockProduitFindAndCountAll.mock.calls[0][0].offset).toBeGreaterThanOrEqual(0);
  });

  /**
   * Sequelize construit sa clause `Op.or` sous une clé SYMBOL. `JSON.stringify`
   * jette les clés symboles sans rien dire : une première version de ces deux
   * tests inspectait donc une chaîne vide et passait sans rien vérifier. On
   * lit la clé directement.
   */
  function motifsDeRecherche(where) {
    const { Op } = require('sequelize');
    const ou = where[Op.or] || [];
    return ou.map((condition) => {
      const champ = Object.keys(condition)[0];
      const comparaison = condition[champ];
      return String(comparaison[Op.iLike] ?? '');
    });
  }

  it('les jokers d\'une recherche sont échappés', async () => {
    // Sans échappement, `%` et `_` sont des jokers SQL : une recherche sur
    // « % » balaie toute la table, et un `\` seul casse le motif.
    await CatalogueService.lister({ q: '100%_coton\\' });

    const { where } = mockProduitFindAndCountAll.mock.calls[0][0];
    const motifs = motifsDeRecherche(where);

    expect(motifs.length).toBeGreaterThan(0); // l'assertion mord bien
    for (const motif of motifs) {
      expect(motif).toContain('\\%');
      expect(motif).toContain('\\_');
      expect(motif).toContain('\\\\');
    }
  });

  it('une recherche démesurée est tronquée à 80 caractères', async () => {
    await CatalogueService.lister({ q: 'a'.repeat(5000) });

    const { where } = mockProduitFindAndCountAll.mock.calls[0][0];
    const motifs = motifsDeRecherche(where);

    expect(motifs.length).toBeGreaterThan(0);
    for (const motif of motifs) {
      // Le motif est `%<recherche>%`, donc 80 + 2 au plus.
      expect(motif.length).toBeLessThanOrEqual(82);
    }
  });

  it('le filtre de visibilité est posé avant tout filtre du client', async () => {
    await CatalogueService.lister({ tri: 'recents' });

    const { where } = mockProduitFindAndCountAll.mock.calls[0][0];
    // D-26 : la surface récente, elle, filtre bien la modération.
    expect(where.statut).toBe('approuve');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  T-09 — type de fichier déterminé par les octets, pas par le client
// ═══════════════════════════════════════════════════════════════════════════

describe('T-09 — le type réel d\'un fichier téléversé', () => {
  const upload = require('../../src/middlewares/upload.middleware');
  const { uploadConfig } = require('../../src/config/security');

  /** Une réponse factice qui retient le statut et le corps. */
  function reponse() {
    const r = { statut: null, corps: null };
    r.status = (s) => { r.statut = s; return r; };
    r.json = (c) => { r.corps = c; return r; };
    return r;
  }

  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  const PDF = Buffer.from('%PDF-1.7\n...');
  const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const HTML = Buffer.from('<html><script>alert(1)</script></html>');
  const ELF = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]);

  it('accepte un vrai PNG et un vrai JPEG', () => {
    for (const [nom, buffer, attendu] of [
      ['png', PNG, 'image/png'],
      ['jpeg', JPEG, 'image/jpeg'],
    ]) {
      const req = { file: { buffer, mimetype: 'application/octet-stream', originalname: nom } };
      const res = reponse();
      const suivant = jest.fn();
      upload.verifyMagicBytes(req, res, suivant);

      expect(suivant).toHaveBeenCalled();
      // Le mimetype déclaré par le client est REMPLACÉ par le type réel.
      expect(req.file.mimetype).toBe(attendu);
    }
  });

  it('refuse un SVG, même annoncé comme une image PNG', () => {
    // Le SVG est le vecteur classique de XSS stocké : il porte du script et
    // les navigateurs l'exécutent. Son absence de la liste blanche est une
    // décision à retenir.
    expect(uploadConfig.allowedMimeTypes).not.toContain('image/svg+xml');

    const req = { file: { buffer: SVG, mimetype: 'image/png', originalname: 'logo.png' } };
    const res = reponse();
    const suivant = jest.fn();
    upload.verifyMagicBytes(req, res, suivant);

    expect(suivant).not.toHaveBeenCalled();
    expect(res.statut).toBe(400);
  });

  it('refuse du HTML et un exécutable déguisés en image', () => {
    for (const buffer of [HTML, ELF]) {
      const req = { file: { buffer, mimetype: 'image/jpeg', originalname: 'photo.jpg' } };
      const res = reponse();
      const suivant = jest.fn();
      upload.verifyMagicBytes(req, res, suivant);

      expect(suivant).not.toHaveBeenCalled();
      expect(res.statut).toBe(400);
    }
  });

  it('refuse un fichier vide ou trop court pour porter une signature', () => {
    for (const buffer of [Buffer.alloc(0), Buffer.from([0x89]), Buffer.from([0x89, 0x50])]) {
      const req = { file: { buffer, mimetype: 'image/png', originalname: 'x.png' } };
      const res = reponse();
      const suivant = jest.fn();
      upload.verifyMagicBytes(req, res, suivant);

      expect(suivant).not.toHaveBeenCalled();
    }
  });

  it('contrôle CHAQUE fichier d\'un envoi multiple, pas seulement le premier', () => {
    // Un seul fichier valide en tête ne doit pas couvrir les suivants.
    const req = {
      files: [
        { buffer: PNG, mimetype: 'image/png', originalname: 'ok.png' },
        { buffer: ELF, mimetype: 'image/png', originalname: 'piege.png' },
      ],
    };
    const res = reponse();
    const suivant = jest.fn();
    upload.verifyMagicBytes(req, res, suivant);

    expect(suivant).not.toHaveBeenCalled();
    expect(res.statut).toBe(400);
  });

  it('contrôle aussi les champs nommés (upload.fields)', () => {
    const req = {
      files: {
        recto: [{ buffer: PNG, mimetype: 'image/png', originalname: 'recto.png' }],
        verso: [{ buffer: ELF, mimetype: 'image/png', originalname: 'verso.png' }],
      },
    };
    const res = reponse();
    const suivant = jest.fn();
    upload.verifyMagicBytes(req, res, suivant);

    expect(suivant).not.toHaveBeenCalled();
    expect(res.statut).toBe(400);
  });

  it('la taille maximale est bornée à 5 Mo', () => {
    expect(uploadConfig.maxFileSize).toBe(5 * 1024 * 1024);
  });

  it('un PDF est accepté — et c\'est trop large pour une photo de produit (L-11)', () => {
    // Comportement ACTUEL, documenté plutôt que corrigé : la liste blanche
    // est unique pour toutes les routes, donc le PDF réservé à la pièce
    // d'identité est aussi accepté comme photo de produit. Pas une faille
    // (les fichiers partent sur une origine séparée, et la CSP de nginx
    // interdit le script externe), mais un affichage cassé.
    const req = { file: { buffer: PDF, mimetype: 'application/pdf', originalname: 'piece.pdf' } };
    const res = reponse();
    const suivant = jest.fn();
    upload.verifyMagicBytes(req, res, suivant);

    expect(suivant).toHaveBeenCalled();
    expect(req.file.mimetype).toBe('application/pdf');
  });
});
