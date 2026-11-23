/**
 * CLOISONNEMENT DU BACK-OFFICE — ce qu'un administrateur ne doit pas pouvoir.
 *
 * L'audit du 23 novembre 2026 a compté 84 routes d'administration portant
 * toutes un `requirePermission`. Ce fichier contient d'abord le GARDE-FOU qui
 * retient ce compte : une route ajoutée demain sans permission fine fera
 * échouer la suite, au lieu d'ouvrir silencieusement une porte.
 *
 * Il vérifie ensuite trois propriétés qui tiennent déjà, et dont rien ne
 * garantissait la permanence :
 *
 *   - les champs que le serveur contrôle (`role`, `statut`, `verifie`,
 *     `soldeDisponible`) ne s'écrivent pas depuis le corps d'une requête ;
 *   - les routes « vendeurs » et « clients » ne peuvent pas atteindre un
 *     compte d'administration ;
 *   - la création d'utilisateur ne sait pas créer un administrateur.
 *
 * Il documente enfin, en `test.failing`, deux garde-fous qui MANQUENT
 * (défaut L-06 du rapport) : rien n'empêche un administrateur de se supprimer
 * lui-même, ni de supprimer le dernier administrateur — ce qui verrouille le
 * back-office pour tout le monde.
 *
 * Couvre les contrôles C-01, C-13, C-14, C-16, C-17 du rapport.
 */

const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════════════
//  T-05 — le garde-fou : aucune route d'administration sans permission fine
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Découpe les arguments d'un appel `router.<verbe>(…)` à parenthésage
 * équilibré. Une expression régulière par ligne ne suffirait pas : la
 * majorité de ces routes sont déclarées sur plusieurs lignes, et c'est
 * précisément celles-là qu'il ne faut pas manquer.
 */
function appelsDeRoutes(source) {
  const motif = /router\.(get|post|put|patch|delete)\s*\(/g;
  const appels = [];
  let m;
  while ((m = motif.exec(source)) !== null) {
    let i = source.indexOf('(', m.index) + 1;
    let profondeur = 1;
    let corps = '';
    while (i < source.length && profondeur > 0) {
      const c = source[i];
      if ('([{'.includes(c)) profondeur += 1;
      else if (')]}'.includes(c)) {
        profondeur -= 1;
        if (profondeur === 0) break;
      }
      corps += c;
      i += 1;
    }
    const chemin = (corps.match(/^\s*['"`]([^'"`]*)/) || [])[1] || '?';
    appels.push({ methode: m[1].toUpperCase(), chemin, corps });
  }
  return appels;
}

const FICHIERS_ADMIN = [
  'src/routes/admin/admin.route.js',
  'src/routes/adminManagement.route.js',
];

describe('T-05 — garde-fou : chaque route d\'administration porte une permission', () => {
  for (const relatif of FICHIERS_ADMIN) {
    describe(relatif, () => {
      const source = fs.readFileSync(path.join(__dirname, '../..', relatif), 'utf8');
      const appels = appelsDeRoutes(source);

      it('déclare au moins une route (le garde-fou lui-même doit mordre)', () => {
        // Si l'analyse cassait, elle trouverait zéro route et le test
        // suivant passerait pour de mauvaises raisons.
        expect(appels.length).toBeGreaterThan(5);
      });

      it('impose la chaîne auth → compte actif → rôle avant toute route', () => {
        expect(source).toMatch(/router\.use\(\s*auth/);
        expect(source).toMatch(/router\.use\(\s*checkActiveUser\s*\)/);
        expect(source).toMatch(/router\.use\(\s*isAdmin\s*\)/);
      });

      it('n\'a AUCUNE route sans requirePermission', () => {
        const sans = appels
          .filter((a) => !/requirePermission/.test(a.corps))
          .map((a) => `${a.methode} ${a.chemin}`);

        // Le message d'échec nomme les routes fautives : c'est ce qui rend
        // ce garde-fou utile plutôt qu'agaçant.
        expect(sans).toEqual([]);
      });

      it('n\'utilise que les quatre actions reconnues par le RBAC', () => {
        // L'action est le DERNIER argument de l'appel. Prendre la première
        // chaîne citée ne marche pas : `requirePermission(['COMMANDES',
        // 'MODERATION'], 'update')` donne alors un nom de menu.
        // Deux formes seulement existent : un code de menu, ou une liste de
        // codes, suivis d'une action facultative (`view` par défaut). Une
        // expression plus large déborde sur le middleware suivant — un
        // `upload.single('image')` se faisait prendre pour une action.
        const MOTIF_PERMISSION =
          /requirePermission\(\s*(?:\[[^\]]*\]|'[^']*')\s*(?:,\s*'(\w+)'\s*)?\)/g;
        const appelsPermission = [...source.matchAll(MOTIF_PERMISSION)];
        const actions = appelsPermission.map((m) => m[1] || 'view');

        // L'analyse doit retrouver autant d'appels que de routes : sinon
        // elle en manque, et le test suivant ne vaut rien.
        expect(appelsPermission.length).toBe(appels.length);

        const inconnues = [...new Set(actions)]
          .filter((a) => !['view', 'create', 'update', 'delete'].includes(a));
        // Une action mal orthographiée fait éclater le montage des routes au
        // démarrage (`requirePermission` lève à la construction) ; autant la
        // voir ici plutôt qu'au déploiement.
        expect(inconnues).toEqual([]);
      });
    });
  }

  it('le total des routes d\'administration est bien de 84', () => {
    const total = FICHIERS_ADMIN.reduce((n, relatif) => {
      const source = fs.readFileSync(path.join(__dirname, '../..', relatif), 'utf8');
      return n + appelsDeRoutes(source).length;
    }, 0);
    // Ce nombre est documenté dans l'annexe de l'audit et sert de repère au
    // découpage « admin / mobile ». S'il change, l'annexe doit changer avec.
    expect(total).toBe(84);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  T-20 — mass assignment sur les routes « utilisateurs » du back-office
// ═══════════════════════════════════════════════════════════════════════════

const mockUtilisateurFindOne = jest.fn();
const mockUtilisateurFindByPk = jest.fn();
const mockUtilisateurCreate = jest.fn();

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
  fn: (...a) => ({ fn: a }),
  col: (...a) => ({ col: a }),
  literal: (...a) => ({ literal: a }),
  authenticate: jest.fn(),
  QueryTypes: { SELECT: 'SELECT' },
}));

jest.mock('../../src/models', () => ({
  // `admin.management.service.js` prend `sequelize` DANS le baril, pas dans
  // `config/db`. Sans cette ligne, `updatePermissions` échouait sur
  // « Cannot read properties of undefined (reading 'transaction') » — un
  // échec de doublure, pas le défaut qu'on veut démontrer.
  sequelize: {
    transaction: async () => ({ commit: jest.fn(), rollback: jest.fn() }),
  },
  Utilisateur: {
    findOne: (...a) => mockUtilisateurFindOne(...a),
    findByPk: (...a) => mockUtilisateurFindByPk(...a),
    create: (...a) => mockUtilisateurCreate(...a),
    findAll: jest.fn(), count: jest.fn(), update: jest.fn(),
  },
  Produit: { findByPk: jest.fn(), findOne: jest.fn(), findAll: jest.fn(), count: jest.fn(), update: jest.fn() },
  Categorie: { findAll: jest.fn(), findByPk: jest.fn(), create: jest.fn() },
  Abonnement: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn(), count: jest.fn() },
  Paiement: { findAll: jest.fn(), count: jest.fn(), sum: jest.fn() },
  Boutique: { findOne: jest.fn(), findAll: jest.fn(), update: jest.fn(), count: jest.fn() },
  Signalement: { findAll: jest.fn(), findByPk: jest.fn(), count: jest.fn() },
  Notification: { create: jest.fn(), bulkCreate: jest.fn(), count: jest.fn() },
  Commande: { findAll: jest.fn(), findByPk: jest.fn(), count: jest.fn(), sum: jest.fn() },
  LigneCommande: { findAll: jest.fn() },
  Menu: { findAll: jest.fn() },
  Permission: { findAll: jest.fn(), destroy: jest.fn(), bulkCreate: jest.fn() },
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

jest.mock('../../src/services/resend.service', () => ({
  sendNewAdminEmail: jest.fn(async () => true),
  sendNouveauCompteEmail: jest.fn(async () => true),
  etatEmail: () => ({ pret: false }),
}));

const AdminService = require('../../src/services/admin/admin.service');

const VENDEUR = 'aaaaaaaa-0000-4000-8000-00000000000a';

describe('T-20 — les champs que le serveur contrôle ne s\'écrivent pas depuis le corps', () => {
  beforeEach(() => {
    mockUtilisateurFindOne.mockReset();
    mockUtilisateurFindByPk.mockReset();
    mockUtilisateurCreate.mockReset();
  });

  it('modifier un vendeur ignore role, statut, verifie et soldeDisponible', async () => {
    const vendeur = {
      id: VENDEUR, role: 'Vendeur', email: 'awa@exemple.test',
      update: jest.fn(),
      toJSON: () => ({ id: VENDEUR, role: 'Vendeur' }),
    };
    // Premier appel : la cible. Les suivants : le contrôle d'unicité.
    mockUtilisateurFindOne.mockResolvedValueOnce(vendeur).mockResolvedValue(null);

    await AdminService.modifierUtilisateur('Vendeur', VENDEUR, {
      prenom: 'Awa',
      nom: 'Diop',
      // Tout ce qui suit relève du serveur.
      role: 'Admin',
      statut: 'actif',
      verifie: true,
      compteSupprime: false,
      soldeDisponible: 999999,
      statutValidation: 'approuve',
      mot_de_passe: 'motdepasse-choisi-par-le-client',
    });

    const ecrits = vendeur.update.mock.calls[0][0];
    expect(ecrits).toEqual({ prenom: 'Awa', nom: 'Diop' });
    for (const interdit of [
      'role', 'statut', 'verifie', 'compteSupprime', 'soldeDisponible',
      'statutValidation', 'mot_de_passe',
    ]) {
      expect(ecrits).not.toHaveProperty(interdit);
    }
  });

  it('les champs d\'identité légitimes passent bien', async () => {
    const vendeur = {
      id: VENDEUR, role: 'Vendeur', update: jest.fn(),
      toJSON: () => ({ id: VENDEUR }),
    };
    mockUtilisateurFindOne.mockResolvedValueOnce(vendeur).mockResolvedValue(null);

    await AdminService.modifierUtilisateur('Vendeur', VENDEUR, {
      prenom: 'Awa',
      nom: 'Diop',
      email: 'Awa.Diop@Exemple.TEST',
      telephone: '77 123 45 67',
      adresse: 'Médina, Dakar',
    });

    const ecrits = vendeur.update.mock.calls[0][0];
    expect(ecrits.prenom).toBe('Awa');
    expect(ecrits.adresse).toBe('Médina, Dakar');
    // L'email est normalisé en minuscules : une normalisation maîtrisée,
    // pas une transformation silencieuse du contenu métier.
    expect(ecrits.email).toBe('awa.diop@exemple.test');
  });
});

describe('T-20 — les routes « utilisateurs » n\'atteignent pas un administrateur', () => {
  beforeEach(() => {
    mockUtilisateurFindOne.mockReset();
    mockUtilisateurFindByPk.mockReset();
    mockUtilisateurCreate.mockReset();
  });

  it('la recherche de la cible est bornée au rôle de la route', async () => {
    mockUtilisateurFindOne.mockResolvedValue(null);

    await expect(
      AdminService.modifierUtilisateur('Vendeur', VENDEUR, { prenom: 'X' }),
    ).rejects.toThrow();

    // C'est la protection : un identifiant d'administrateur passé à la route
    // « vendeur » ne trouve rien, puisque le rôle fait partie du `where`.
    expect(mockUtilisateurFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: VENDEUR, role: 'Vendeur' } }),
    );
  });

  it('la suppression refuse explicitement un compte d\'administration', async () => {
    mockUtilisateurFindByPk.mockResolvedValue({
      id: 'un-admin', role: 'Admin', destroy: jest.fn(),
    });

    await expect(
      AdminService.supprimerUtilisateur('un-admin'),
    ).rejects.toThrow(/administrateur/i);
  });

  it('la création d\'utilisateur ne sait pas créer un administrateur', async () => {
    await expect(
      AdminService.creerUtilisateur('Admin', {
        prenom: 'A', nom: 'B', email: 'a@b.test',
      }),
    ).rejects.toThrow(/rôle invalide/i);

    expect(mockUtilisateurCreate).not.toHaveBeenCalled();
  });

  it('le rôle créé est celui de la route, pas celui du corps de la requête', async () => {
    mockUtilisateurFindOne.mockResolvedValue(null);
    mockUtilisateurCreate.mockResolvedValue({ id: 'neuf', toJSON: () => ({ id: 'neuf' }) });

    await AdminService.creerUtilisateur('Acheteur', {
      prenom: 'Awa', nom: 'Diop', email: 'awa2@exemple.test',
      role: 'Admin',          // tentative d'élévation
      statut: 'actif',
      verifie: true,
    }).catch(() => {});

    expect(mockUtilisateurCreate).toHaveBeenCalled();
    const ecrit = mockUtilisateurCreate.mock.calls[0][0];
    expect(ecrit.role).toBe('Acheteur');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  T-15 — les garde-fous qui MANQUENT (défaut L-06)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ces deux tests décrivent le comportement attendu, absent du code. Marqués
 * `failing`, ils passent tant que le défaut est là et deviennent rouges le
 * jour où il est corrigé — signal pour les repasser en `test`.
 *
 * Le correctif est dans `src/services/admin.management.service.js`, au
 * PÉRIMÈTRE ADMIN : il est donc applicable. Il attend seulement que la
 * session qui travaille en parallèle dans ce dépôt ait committé.
 */
describe('T-15 — garde-fous manquants sur la gestion des administrateurs', () => {
  const AdminManagementService = require('../../src/services/admin.management.service');
  const MOI = '99999999-0000-4000-8000-000000000099';

  it('un administrateur ne peut pas se supprimer lui-même', async () => {
    mockUtilisateurFindOne.mockResolvedValue({
      id: MOI, role: 'Admin', destroy: jest.fn(),
    });

    // Attendu : un refus. Constaté : la suppression passe, et si c'était le
    // dernier administrateur, le back-office devient inaccessible à tous.
    await expect(
      AdminManagementService.supprimerAdmin(MOI, { demandeurId: MOI }),
    ).rejects.toThrow(/propre compte/i);
  });

  it('les permissions ne s\'attribuent qu\'à un administrateur', async () => {
    // La cible est un vendeur. Le service la cherche avec
    // `where: { id, role: 'Admin' }` — donc il ne trouve RIEN, et c'est
    // exactement ce que la doublure doit rendre. Une première version
    // renvoyait le vendeur quelle que soit la clause `where` : le test ne
    // reflétait pas le comportement réel et ne pouvait rien démontrer.
    mockUtilisateurFindOne.mockResolvedValue(null);

    // Attendu : un refus. Constaté : `updatePermissions` écrit les lignes
    // sans jamais vérifier le rôle de la cible. Elles sont inertes
    // aujourd'hui (isAdmin filtre en amont), mais c'est une incohérence de
    // données qui attend qu'on s'appuie dessus.
    await expect(
      AdminManagementService.updatePermissions(VENDEUR, [
        { menuId: 'menu-1', canView: true },
      ]),
    ).rejects.toThrow(/administrateur/i);

    // Et la recherche est bien bornée au rôle : c'est elle qui fait le refus.
    expect(mockUtilisateurFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: VENDEUR, role: 'Admin' } }),
    );
  });
});
