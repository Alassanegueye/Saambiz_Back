/**
 * ISOLATION ENTRE BOUTIQUES — le vendeur B contre le vendeur A.
 *
 * L'audit du 23 novembre 2026 a établi que l'isolation est bien implémentée :
 * chaque accès par identifiant est borné DANS la clause `where`
 * (`where: { id: produitId, vendeurId }`), et non vérifié après chargement.
 *
 * Et il a établi autre chose : AUCUN des 932 tests d'alors n'exerçait cette
 * isolation. Elle tenait à la seule discipline d'écriture. Remplacer
 * `findOne({ where: { id, vendeurId } })` par `findByPk(id)` au cours d'un
 * remaniement aurait ouvert la boutique de chacun à tous les autres, et la
 * suite serait restée verte.
 *
 * C'est ce que ce fichier ferme. Il ne vérifie pas seulement qu'un refus
 * arrive : il vérifie que la requête PORTE le `vendeurId`. La nuance compte —
 * un service qui chargerait le produit sans contrainte puis comparerait les
 * identifiants passerait un test « ça refuse bien » tout en restant fragile,
 * parce que la protection vivrait dans une branche que le prochain chemin
 * d'appel oublierait.
 *
 * Couvre les contrôles A-02 à A-06, A-08, A-25, A-26, C-10 du rapport.
 */

const mockProduitFindOne = jest.fn();
const mockProduitFindAll = jest.fn();
const mockProduitFindAndCountAll = jest.fn();
const mockProduitCreate = jest.fn();
const mockProduitUpdate = jest.fn();
const mockProduitCount = jest.fn();
const mockBoutiqueFindOne = jest.fn();
const mockFavoriFindOne = jest.fn();
const mockCommandeFindAll = jest.fn();
const mockProduitImageFindOne = jest.fn();
const mockProduitImageCount = jest.fn();

jest.mock('../../src/models', () => ({
  Produit: {
    findOne: (...a) => mockProduitFindOne(...a),
    findAll: (...a) => mockProduitFindAll(...a),
    findAndCountAll: (...a) => mockProduitFindAndCountAll(...a),
    create: (...a) => mockProduitCreate(...a),
    update: (...a) => mockProduitUpdate(...a),
    count: (...a) => mockProduitCount(...a),
  },
  ProduitImage: {
    findOne: (...a) => mockProduitImageFindOne(...a),
    count: (...a) => mockProduitImageCount(...a),
    bulkCreate: jest.fn(),
  },
  Boutique: { findOne: (...a) => mockBoutiqueFindOne(...a), findAll: jest.fn() },
  Favori: { findOne: (...a) => mockFavoriFindOne(...a), findAll: jest.fn(), count: jest.fn() },
  Commande: { findAll: (...a) => mockCommandeFindAll(...a), count: jest.fn(), sum: jest.fn() },
  LigneCommande: { findAll: jest.fn() },
  Categorie: { findByPk: jest.fn(), findAll: jest.fn() },
  Abonnement: { findOne: jest.fn(), findAll: jest.fn() },
  Message: { count: jest.fn(), findAll: jest.fn() },
  Paiement: { findAll: jest.fn() },
  Utilisateur: { findByPk: jest.fn(), findOne: jest.fn() },
}));

// `modifierProduit` et `supprimerProduit` ouvrent une transaction.
//
// `define` fait partie de la doublure : plusieurs modèles sont chargés en
// cascade par les services voisins et l'appellent au chargement du module.
// Sans lui, la suite échoue avant d'exécuter un seul test.
const mockQuery = jest.fn();
const mockModeleFactice = () => ({
  findOne: jest.fn(), findAll: jest.fn(), findByPk: jest.fn(),
  create: jest.fn(), update: jest.fn(), destroy: jest.fn(), count: jest.fn(),
  belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(),
  belongsToMany: jest.fn(), addHook: jest.fn(), sync: jest.fn(),
});
jest.mock('../../src/config/db', () => ({
  define: () => mockModeleFactice(),
  transaction: async () => ({ commit: jest.fn(), rollback: jest.fn(), LOCK: { UPDATE: 'UPDATE' } }),
  query: (...a) => mockQuery(...a),
  fn: (...a) => ({ fn: a }),
  col: (...a) => ({ col: a }),
  literal: (...a) => ({ literal: a }),
  authenticate: jest.fn(),
  QueryTypes: { SELECT: 'SELECT' },
}));

// La chaîne notifications → sockets → modèles n'a rien à voir avec
// l'isolation : on l'écarte pour que l'échec éventuel désigne la bonne cause.
jest.mock('../../src/services/notifications/notification.service', () => ({
  notifierUtilisateur: jest.fn(),
  notifierUtilisateurs: jest.fn(),
  notifierAbonnesDuVendeur: jest.fn(),
  creerNotification: jest.fn(),
}));

jest.mock('../../src/services/stockage/upload.service', () => ({
  uploadImage: jest.fn(async () => 'https://exemple.test/image.jpg'),
  uploadDocumentPrive: jest.fn(),
  deleteImage: jest.fn(),
}));

const VendeurService = require('../../src/services/vendeurs/vendeur.service');

const VENDEUR_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const VENDEUR_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const PRODUIT_DE_A = 'aaaaaaaa-1111-4000-8000-000000000001';
const IMAGE_DE_A = 'aaaaaaaa-2222-4000-8000-000000000002';
const PHOTO_DE_A = 'photo-de-a';
const ACHETEUR = 'cccccccc-0000-4000-8000-00000000000c';

/** Le produit visé appartient à A : une requête bornée à B ne le trouve pas. */
function produitIntrouvablePourB() {
  mockProduitFindOne.mockResolvedValue(null);
}

/** Les arguments `where` de la dernière recherche de produit. */
function dernierWhereProduit() {
  const appels = mockProduitFindOne.mock.calls;
  return appels[appels.length - 1][0].where;
}

beforeEach(() => {
  for (const m of [
    mockProduitFindOne, mockProduitFindAll, mockProduitFindAndCountAll,
    mockProduitCreate, mockProduitUpdate, mockProduitCount,
    mockBoutiqueFindOne, mockFavoriFindOne, mockCommandeFindAll,
    mockProduitImageFindOne, mockProduitImageCount, mockQuery,
  ]) m.mockReset();
});

// ═══════════════════════════════════════════════════════════════════════════
//  T-01 — un vendeur ne touche pas aux produits d'un autre
// ═══════════════════════════════════════════════════════════════════════════

describe('T-01 — produits : le vendeur B contre le vendeur A', () => {
  it('modifier : refuse, et la requête porte le vendeurId', async () => {
    produitIntrouvablePourB();

    await expect(
      VendeurService.modifierProduit(VENDEUR_B, PRODUIT_DE_A, { nom: 'Détourné' }),
    ).rejects.toThrow();

    expect(dernierWhereProduit()).toEqual(
      expect.objectContaining({ id: PRODUIT_DE_A, vendeurId: VENDEUR_B }),
    );
  });

  it('supprimer : refuse, et la requête porte le vendeurId', async () => {
    produitIntrouvablePourB();

    await expect(
      VendeurService.supprimerProduit(VENDEUR_B, PRODUIT_DE_A),
    ).rejects.toThrow();

    expect(dernierWhereProduit()).toEqual(
      expect.objectContaining({ id: PRODUIT_DE_A, vendeurId: VENDEUR_B }),
    );
  });

  it('basculer la disponibilité : refuse, et la requête porte le vendeurId', async () => {
    produitIntrouvablePourB();

    await expect(
      VendeurService.toggleDisponibilite(VENDEUR_B, PRODUIT_DE_A),
    ).rejects.toThrow();

    expect(dernierWhereProduit()).toEqual(
      expect.objectContaining({ id: PRODUIT_DE_A, vendeurId: VENDEUR_B }),
    );
  });

  it('dupliquer : refuse, et ne crée rien', async () => {
    produitIntrouvablePourB();

    await expect(
      VendeurService.dupliquerProduit(VENDEUR_B, PRODUIT_DE_A),
    ).rejects.toThrow();

    expect(dernierWhereProduit()).toEqual(
      expect.objectContaining({ id: PRODUIT_DE_A, vendeurId: VENDEUR_B }),
    );
    // Le point qui compte : aucune copie du produit d'autrui dans la
    // boutique de B.
    expect(mockProduitCreate).not.toHaveBeenCalled();
  });

  it('ajouter des images : refuse, et ne téléverse rien', async () => {
    produitIntrouvablePourB();
    const { uploadImage } = require('../../src/services/stockage/upload.service');
    uploadImage.mockClear();

    await expect(
      VendeurService.ajouterImagesProduit(VENDEUR_B, PRODUIT_DE_A, [
        { buffer: Buffer.from('faux') },
      ]),
    ).rejects.toThrow();

    expect(dernierWhereProduit()).toEqual(
      expect.objectContaining({ id: PRODUIT_DE_A, vendeurId: VENDEUR_B }),
    );
    // Le refus doit arriver AVANT le téléversement : sinon on paie le
    // stockage d'un fichier qu'on refuse ensuite d'attacher.
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('supprimer une image : refuse avant même de chercher l\'image', async () => {
    produitIntrouvablePourB();

    await expect(
      VendeurService.supprimerImageProduit(VENDEUR_B, PRODUIT_DE_A, IMAGE_DE_A),
    ).rejects.toThrow();

    expect(dernierWhereProduit()).toEqual(
      expect.objectContaining({ id: PRODUIT_DE_A, vendeurId: VENDEUR_B }),
    );
    // L'ordre est la protection : le produit d'abord, l'image ensuite. Si
    // l'image était cherchée la première, son identifiant suffirait à
    // atteindre celle d'un concurrent.
    expect(mockProduitImageFindOne).not.toHaveBeenCalled();
  });

  it('le propriétaire légitime, lui, passe', async () => {
    const produit = {
      id: PRODUIT_DE_A,
      vendeurId: VENDEUR_A,
      categorieId: null,
      update: jest.fn(),
    };
    mockProduitFindOne.mockResolvedValue(produit);

    await VendeurService.modifierProduit(VENDEUR_A, PRODUIT_DE_A, { nom: 'Nom légitime' });

    expect(produit.update).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  T-07 — mass assignment : les champs que le serveur contrôle
// ═══════════════════════════════════════════════════════════════════════════

describe('T-07 — mass assignment sur un produit', () => {
  it('ignore vendeurId, statut, vues et nombre_ventes envoyés dans le corps', async () => {
    const produit = {
      id: PRODUIT_DE_A,
      vendeurId: VENDEUR_A,
      categorieId: null,
      update: jest.fn(),
    };
    mockProduitFindOne.mockResolvedValue(produit);

    await VendeurService.modifierProduit(VENDEUR_A, PRODUIT_DE_A, {
      nom: 'Nom légitime',
      // Tout ce qui suit est décidé par le serveur, jamais par le client.
      vendeurId: VENDEUR_B,       // offrir son produit à un concurrent
      statut: 'approuve',         // contourner la modération
      vues: 999999,               // truquer le tri « populaire »
      nombre_ventes: 999999,      // truquer le classement
      soldeDisponible: 999999,    // n'appartient même pas à ce modèle
      id: 'autre-identifiant',    // se faire passer pour un autre produit
    });

    expect(produit.update).toHaveBeenCalled();
    const ecrits = produit.update.mock.calls[0][0];

    expect(ecrits).toEqual({ nom: 'Nom légitime' });
    for (const interdit of [
      'vendeurId', 'statut', 'vues', 'nombre_ventes', 'soldeDisponible', 'id',
    ]) {
      expect(ecrits).not.toHaveProperty(interdit);
    }
  });

  it('laisse passer tous les champs légitimes de la liste blanche', async () => {
    const produit = { id: PRODUIT_DE_A, vendeurId: VENDEUR_A, categorieId: 'cat-1', update: jest.fn() };
    mockProduitFindOne.mockResolvedValue(produit);

    await VendeurService.modifierProduit(VENDEUR_A, PRODUIT_DE_A, {
      nom: 'Sac en wax',
      description: 'Cousu à Dakar',
      prix: 15000,
      quantite: 4,
      marque: 'Atelier Sénégal',
      disponible: true,
    });

    const ecrits = produit.update.mock.calls[0][0];
    // La liste blanche ne doit pas se refermer sur le métier : une
    // protection qui empêche de modifier son propre produit serait un
    // défaut, pas une sécurité.
    expect(ecrits).toMatchObject({
      nom: 'Sac en wax',
      description: 'Cousu à Dakar',
      prix: 15000,
      quantite: 4,
      marque: 'Atelier Sénégal',
      disponible: true,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  T-01 (suite) — recherche et abonnés
// ═══════════════════════════════════════════════════════════════════════════

describe('T-01 — recherche et abonnés bornés au vendeur', () => {
  it('la recherche de produits part de { vendeurId }, avant tout filtre', async () => {
    mockProduitFindAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await VendeurService.rechercherMesProduits(VENDEUR_A, {
      q: 'sac',
      categorieId: 'cat-1',
      disponible: 'true',
    });

    const { where } = mockProduitFindAndCountAll.mock.calls[0][0];
    expect(where).toEqual(expect.objectContaining({ vendeurId: VENDEUR_A }));
  });

  it('un filtre de recherche ne peut pas effacer le bornage au vendeur', async () => {
    mockProduitFindAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    // Un client malveillant tente de réécrire la contrainte par la query.
    await VendeurService.rechercherMesProduits(VENDEUR_A, {
      q: 'sac',
      vendeurId: VENDEUR_B,
    });

    const { where } = mockProduitFindAndCountAll.mock.calls[0][0];
    expect(where.vendeurId).toBe(VENDEUR_A);
  });

  it('le détail d\'un abonné passe par la boutique du vendeur connecté', async () => {
    mockBoutiqueFindOne.mockResolvedValue({ id: 'boutique-de-a' });
    mockFavoriFindOne.mockResolvedValue(null);

    await expect(
      VendeurService.abonneDetail(VENDEUR_A, ACHETEUR),
    ).rejects.toThrow();

    // La boutique est résolue depuis le vendeur connecté…
    expect(mockBoutiqueFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { vendeurId: VENDEUR_A } }),
    );
    // …et le favori est borné à CETTE boutique, pas à un identifiant reçu.
    expect(mockFavoriFindOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ boutiqueId: 'boutique-de-a', acheteurId: ACHETEUR }),
      }),
    );
  });

  it('un identifiant d\'abonné malformé est refusé avant d\'atteindre SQL', async () => {
    await expect(
      VendeurService.abonneDetail(VENDEUR_A, "pas-un-uuid' OR 1=1 --"),
    ).rejects.toThrow();

    // Aucune requête : le format est contrôlé en amont.
    expect(mockBoutiqueFindOne).not.toHaveBeenCalled();
    expect(mockFavoriFindOne).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  T-01 (suite) — opérations en masse
// ═══════════════════════════════════════════════════════════════════════════

describe('T-01 — pause et réactivation de boutique bornées', () => {
  it('la mise en pause ne touche que les produits du vendeur connecté', async () => {
    mockBoutiqueFindOne.mockResolvedValue({ id: 'boutique-de-a' });
    mockProduitUpdate.mockResolvedValue([3]);

    await VendeurService.pauseBoutique(VENDEUR_A);

    expect(mockProduitUpdate).toHaveBeenCalledWith(
      { disponible: false },
      expect.objectContaining({ where: { vendeurId: VENDEUR_A } }),
    );
  });

  it('la réactivation ne touche que les produits du vendeur connecté', async () => {
    mockBoutiqueFindOne.mockResolvedValue({ id: 'boutique-de-a' });
    mockProduitUpdate.mockResolvedValue([3]);

    await VendeurService.reactiverBoutique(VENDEUR_A);

    expect(mockProduitUpdate).toHaveBeenCalledWith(
      { disponible: true },
      expect.objectContaining({ where: { vendeurId: VENDEUR_A } }),
    );
  });
});
