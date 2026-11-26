/**
 * AUTHENTIFICATION — ce qui tient, et deux choses qui ne tiennent pas.
 *
 * Trois protections de la connexion méritaient d'être retenues par un test,
 * parce qu'elles sont fines et qu'un remaniement les perdrait sans bruit :
 *
 *   - le temps de réponse est ÉGALISÉ avec un hachage factice. Sans cela, un
 *     compte inexistant répond en ~1 ms là où un compte existant coûte un
 *     bcrypt à 12 tours (~200 ms). L'écart se mesure et dresse la liste des
 *     adresses inscrites ;
 *   - le message d'échec est générique ;
 *   - les trois secrets JWT sont distincts, ce qui ferme la confusion entre
 *     jeton d'accès, de rafraîchissement et de réinitialisation.
 *
 * Et deux défauts de l'audit du 23 novembre 2026 sont documentés ici en
 * `test.failing` :
 *
 *   - B-07 / M-01 : l'état du compte est révélé AVANT la vérification du mot
 *     de passe, ce qui rouvre l'énumération que le hachage factice ferme ;
 *   - E-04 / L-01 : `jwt.verify` est appelé sans épingler l'algorithme.
 *
 * Note sur L-04, que ce fichier ne peut pas prouver : la référence de commande
 * vient de `Math.random()`, qui n'est pas cryptographique. On ne démontre pas
 * la prévisibilité d'un générateur par un test unitaire — on vérifie ici le
 * format et l'absence de collision, et le remplacement par `crypto` reste une
 * recommandation du rapport.
 */

const jwt = require('jsonwebtoken');

const mockUtilisateurFindOne = jest.fn();
const mockUtilisateurFindByPk = jest.fn();
const mockBlacklistFindOne = jest.fn();

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

// Deux chemins d'accès aux mêmes modèles, donc deux doublures qui partagent
// les mêmes fonctions : `auth.middleware` charge les fichiers de modèle un à
// un, tandis que `auth.service` passe par le baril `src/models`. Doubler un
// seul des deux laisserait l'autre charger les vrais modèles — et c'est ce
// qui faisait échouer la suite au chargement, sur une méthode de prototype.
jest.mock('../../src/models/utilisateur.model', () => ({
  findByPk: (...a) => mockUtilisateurFindByPk(...a),
  findOne: (...a) => mockUtilisateurFindOne(...a),
}));

jest.mock('../../src/models/tokenBlacklist.model', () => ({
  findOne: (...a) => mockBlacklistFindOne(...a),
  create: jest.fn(),
}));

jest.mock('../../src/models', () => ({
  Utilisateur: {
    findByPk: (...a) => mockUtilisateurFindByPk(...a),
    findOne: (...a) => mockUtilisateurFindOne(...a),
    update: jest.fn(), create: jest.fn(),
  },
  TokenBlacklist: {
    findOne: (...a) => mockBlacklistFindOne(...a),
    create: jest.fn(), destroy: jest.fn(),
  },
  Boutique: { findOne: jest.fn(), create: jest.fn() },
  Abonnement: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() },
  UserOtp: { findOne: jest.fn(), create: jest.fn(), destroy: jest.fn() },
  Permission: { findAll: jest.fn() },
  Menu: { findAll: jest.fn() },
  RefreshToken: { create: jest.fn(), findOne: jest.fn(), findAll: jest.fn(), update: jest.fn(), destroy: jest.fn() },
  Commande: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() },
  LigneCommande: { findAll: jest.fn(), bulkCreate: jest.fn() },
  Produit: { findAll: jest.fn(), findByPk: jest.fn(), increment: jest.fn() },
  HistoriqueCommande: { create: jest.fn() },
  Utilisateurs: undefined,
}));

jest.mock('../../src/services/notifications/notification.service', () => ({
  notifierUtilisateur: jest.fn(),
  notifierUtilisateurs: jest.fn(),
  notifierAbonnesDuVendeur: jest.fn(),
  creerNotification: jest.fn(),
}));

const { jwtConfig } = require('../../src/config/security');

/**
 * Exécute un middleware et attend réellement sa fin.
 *
 * `asyncHandler` ne REND PAS la promesse qu'il crée
 * (`asyncHandler.js:13` : `Promise.resolve(fn(…)).catch(next)`). Un simple
 * `await middleware(req, res, next)` rend donc la main avant que le
 * middleware ait fini, et l'assertion court contre la file de microtâches :
 * un rejet synchrone arrive à temps, un `await` en base non. Deux de mes
 * premières versions de ces tests passaient pour cette mauvaise raison.
 *
 * Rend l'erreur passée à `next`, ou `undefined` si le middleware a laissé
 * passer la requête.
 */
function executerMiddleware(middleware, req) {
  return new Promise((resolve, reject) => {
    const minuteur = setTimeout(
      () => reject(new Error('le middleware n\'a jamais appelé next()')),
      1000,
    );
    middleware(req, {}, (erreur) => {
      clearTimeout(minuteur);
      resolve(erreur);
    });
  });
}

beforeEach(() => {
  mockUtilisateurFindOne.mockReset();
  mockUtilisateurFindByPk.mockReset();
  mockBlacklistFindOne.mockReset().mockResolvedValue(null);
});

// ═══════════════════════════════════════════════════════════════════════════
//  E-02 — trois usages, trois secrets
// ═══════════════════════════════════════════════════════════════════════════

describe('E-02 — les secrets JWT sont distincts', () => {
  it('accès, rafraîchissement et réinitialisation ne partagent aucun secret', () => {
    const secrets = [jwtConfig.secret, jwtConfig.refreshSecret, jwtConfig.resetSecret];
    expect(new Set(secrets).size).toBe(3);
  });

  it('un jeton de rafraîchissement n\'est pas acceptable comme jeton d\'accès', () => {
    const refresh = jwt.sign({ id: 'u1', jti: 'x' }, jwtConfig.refreshSecret);
    // C'est cette séparation qui rend inutile un contrôle de type dans la
    // charge utile : la signature ne correspond simplement pas.
    expect(() => jwt.verify(refresh, jwtConfig.secret)).toThrow();
  });

  it('un jeton de réinitialisation n\'est pas acceptable comme jeton d\'accès', () => {
    const reset = jwt.sign({ id: 'u1' }, jwtConfig.resetSecret);
    expect(() => jwt.verify(reset, jwtConfig.secret)).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  E-04 / L-01 — l'algorithme n'est pas épinglé
// ═══════════════════════════════════════════════════════════════════════════

describe('E-04 — épinglage de l\'algorithme de signature', () => {
  it('le middleware d\'authentification accepte un jeton HS256 légitime', async () => {
    const authMiddleware = require('../../src/middlewares/auth.middleware');
    const token = jwt.sign({ id: 'u1' }, jwtConfig.secret, { algorithm: 'HS256' });
    mockUtilisateurFindByPk.mockResolvedValue({ id: 'u1', statut: 'actif' });

    const req = { headers: { authorization: `Bearer ${token}` } };
    const erreur = await executerMiddleware(authMiddleware, req);

    expect(erreur).toBeUndefined();
    expect(req.user.id).toBe('u1');
  });

  it('refuse un jeton signé en HS512 avec le même secret', async () => {
    const authMiddleware = require('../../src/middlewares/auth.middleware');
    // `jwt.verify(token, secret)` sans option `algorithms` accepte toute la
    // famille HMAC. Aucun jeton légitime n'est émis en HS512 : accepter
    // cette variante élargit la surface sans aucun bénéfice.
    const token = jwt.sign({ id: 'u1' }, jwtConfig.secret, { algorithm: 'HS512' });
    mockUtilisateurFindByPk.mockResolvedValue({ id: 'u1', statut: 'actif' });

    const req = { headers: { authorization: `Bearer ${token}` } };
    const erreur = await executerMiddleware(authMiddleware, req);

    // Attendu : une erreur. Constaté : le jeton passe, et `req.user` est
    // renseigné comme pour un jeton légitime.
    expect(erreur).toBeDefined();
  });

  it('refuse un jeton « alg: none » — jsonwebtoken 9 ferme déjà ce cas', async () => {
    const authMiddleware = require('../../src/middlewares/auth.middleware');
    const entete = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const charge = Buffer.from(JSON.stringify({ id: 'u1' })).toString('base64url');
    const token = `${entete}.${charge}.`;

    const req = { headers: { authorization: `Bearer ${token}` } };
    const erreur = await executerMiddleware(authMiddleware, req);

    expect(erreur).toBeDefined();
    expect(req.user).toBeUndefined();
  });

  it('refuse un jeton signé avec un autre secret', async () => {
    const authMiddleware = require('../../src/middlewares/auth.middleware');
    const token = jwt.sign({ id: 'u1' }, 'z'.repeat(40));

    const req = { headers: { authorization: `Bearer ${token}` } };
    const erreur = await executerMiddleware(authMiddleware, req);

    expect(erreur).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  E-07 — la signature est vérifiée avant toute requête en base
// ═══════════════════════════════════════════════════════════════════════════

describe('E-07 — aucune requête en base pour un jeton fabriqué', () => {
  it('le middleware obligatoire vérifie la signature d\'abord', async () => {
    const authMiddleware = require('../../src/middlewares/auth.middleware');
    const req = { headers: { authorization: 'Bearer pas.un.jeton' } };

    await executerMiddleware(authMiddleware, req);

    // Sans cet ordre, envoyer des jetons bidons en rafale ferait travailler
    // PostgreSQL à chaque requête.
    expect(mockBlacklistFindOne).not.toHaveBeenCalled();
    expect(mockUtilisateurFindByPk).not.toHaveBeenCalled();
  });

  it('le middleware FACULTATIF devrait faire de même (L-07)', async () => {
    const authOptionnel = require('../../src/middlewares/authOptionnel.middleware');
    const req = { headers: { authorization: 'Bearer pas.un.jeton' } };

    await executerMiddleware(authOptionnel, req);

    // `authOptionnel` consulte la liste noire AVANT de vérifier la
    // signature — l'ordre inverse de `auth.middleware`, qui documente
    // pourtant précisément pourquoi la signature passe d'abord. Les routes
    // concernées sont publiques, donc atteignables sans compte.
    expect(mockBlacklistFindOne).not.toHaveBeenCalled();
  });

  it('un jeton invalide laisse simplement passer en invité', async () => {
    const authOptionnel = require('../../src/middlewares/authOptionnel.middleware');
    const req = { headers: { authorization: 'Bearer pas.un.jeton' } };

    const erreur = await executerMiddleware(authOptionnel, req);

    // Aucun cas d'erreur ne bloque : on retombe simplement en invité.
    expect(erreur).toBeUndefined();
    expect(req.user).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  T-04 — énumération de comptes à la connexion
// ═══════════════════════════════════════════════════════════════════════════

describe('T-04 — énumération de comptes', () => {
  const AuthService = require('../../src/services/auth.service');

  it('un compte inconnu reçoit un message générique', async () => {
    mockUtilisateurFindOne.mockResolvedValue(null);

    const r = await AuthService.login({
      identifiant: 'inconnu@exemple.test',
      mot_de_passe: 'MotDePasse1!',
    });

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/identifiant ou mot de passe incorrect/i);
    // Et surtout : rien qui désigne l'absence du compte.
    expect(JSON.stringify(r)).not.toMatch(/introuvable|inexistant|aucun compte/i);
  });

  it('un compte inconnu paie quand même un hachage — le temps ne trahit rien', async () => {
    const bcrypt = require('bcryptjs');
    const espion = jest.spyOn(bcrypt, 'compare');
    mockUtilisateurFindOne.mockResolvedValue(null);

    await AuthService.login({
      identifiant: 'inconnu@exemple.test',
      mot_de_passe: 'MotDePasse1!',
    });

    // C'est la finesse qui ferme l'énumération par chronométrage : on paie
    // le même prix qu'un compte existant.
    expect(espion).toHaveBeenCalled();
    espion.mockRestore();
  });

  it.failing('un compte SUPPRIMÉ ne se distingue pas d\'un compte inconnu (M-01)', async () => {
    mockUtilisateurFindOne.mockResolvedValue({
      id: 'u1', email: 'supprime@exemple.test',
      compteSupprime: true, statut: 'inactif',
      mot_de_passe: '$2a$12$' + 'x'.repeat(53),
    });

    const r = await AuthService.login({
      identifiant: 'supprime@exemple.test',
      mot_de_passe: 'MauvaisMotDePasse1!',
    });

    // Attendu avec un mot de passe FAUX : le message générique.
    // Constaté : « Ce compte a été supprimé. » — ce qui confirme à
    // l'attaquant que l'adresse est inscrite, sans qu'il connaisse le mot
    // de passe.
    expect(r.error || r.message).toMatch(/identifiant ou mot de passe incorrect/i);
  });

  it.failing('un compte SUSPENDU ne se distingue pas d\'un compte inconnu (M-01)', async () => {
    mockUtilisateurFindOne.mockResolvedValue({
      id: 'u2', email: 'suspendu@exemple.test',
      compteSupprime: false, statut: 'inactif',
      mot_de_passe: '$2a$12$' + 'x'.repeat(53),
    });

    const r = await AuthService.login({
      identifiant: 'suspendu@exemple.test',
      mot_de_passe: 'MauvaisMotDePasse1!',
    });

    // Pire que le cas précédent : ce chemin ne passe même pas par bcrypt,
    // donc il répond plus vite. L'énumération marche au message ET au temps.
    expect(r.error || r.message).toMatch(/identifiant ou mot de passe incorrect/i);
  });

  it('le message précis reste dû à qui donne le BON mot de passe', async () => {
    const bcrypt = require('bcryptjs');
    const espion = jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    mockUtilisateurFindOne.mockResolvedValue({
      id: 'u3', email: 'suspendu@exemple.test',
      compteSupprime: false, statut: 'inactif',
      mot_de_passe: 'peu-importe',
    });

    const r = await AuthService.login({
      identifiant: 'suspendu@exemple.test',
      mot_de_passe: 'LeBonMotDePasse1!',
    });

    // Le correctif proposé pour M-01 ne doit pas priver l'utilisateur
    // légitime de l'explication : un compte suspendu doit savoir pourquoi
    // il n'entre pas. Ce test garde cette exigence en vue.
    expect(r.success).toBe(false);
    expect(JSON.stringify(r)).toMatch(/inactif|désactiv|supprim/i);
    espion.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  T-17 — référence de commande
// ═══════════════════════════════════════════════════════════════════════════

describe('T-17 — référence de commande', () => {
  const CommandeService = require('../../src/services/commandes/commande.service');

  it('fait douze caractères (60 bits) et ne collisionne pas sur 10 000 tirages', () => {
    const vues = new Set();
    for (let i = 0; i < 10000; i += 1) {
      const ref = CommandeService._genererReference();
      // Le numéro suffit à suivre, modifier et annuler une commande sur
      // saambiz.com : c'est un secret, 32¹² valeurs.
      expect(ref).toMatch(/^CMD-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
      vues.add(ref);
    }
    expect(vues.size).toBe(10000);
  });

  it('tire sur tout l\'alphabet (base 32 sans I, L, O, U), sans favori marqué', () => {
    const comptes = new Map();
    for (let i = 0; i < 10000; i += 1) {
      for (const c of CommandeService._genererReference().replace(/^CMD-|-/g, '')) {
        comptes.set(c, (comptes.get(c) || 0) + 1);
      }
    }
    // 32 caractères attendus, 120 000 tirages : 3 750 par caractère.
    expect(comptes.size).toBe(32);
    for (const c of 'ILOU') expect(comptes.has(c)).toBe(false);
    for (const n of comptes.values()) {
      expect(n).toBeGreaterThan(3750 * 0.8);
      expect(n).toBeLessThan(3750 * 1.2);
    }
  });

  it('relit un numéro saisi à la main, et refuse ce qui n\'a pas le format sûr', () => {
    const ref = CommandeService._genererReference();
    expect(CommandeService.normaliserReference(ref.toLowerCase())).toBe(ref);
    expect(CommandeService.normaliserReference(ref.replace(/-/g, ' '))).toBe(ref);
    expect(CommandeService.normaliserReference('cmd 0a1b-2c3d-4e5f')).toBe('CMD-0A1B-2C3D-4E5F');
    // O se lit 0, I et L se lisent 1.
    expect(CommandeService.normaliserReference('CMD-OAIB-2C3D-4E5L')).toBe('CMD-0A1B-2C3D-4E51');
    expect(CommandeService.normaliserReference('CMD-2026-ABC123')).toBeNull();
    expect(CommandeService.normaliserReference('CMD-0A1B-2C3D-4E5')).toBeNull();
    expect(CommandeService.normaliserReference('CMD-0A1B-2C3D-4E5U')).toBeNull();
    expect(CommandeService.normaliserReference('')).toBeNull();
  });

  it('la référence n\'est pas tirée par Math.random', () => {
    // La référence est le SECOND facteur du suivi de commande sans compte
    // (`GET /vitrine/commande/:reference`, avec le téléphone). L'état interne
    // de `Math.random` se reconstitue à partir de quelques tirages observés :
    // un vendeur qui collecte les références de ses propres commandes
    // pourrait prédire les suivantes. Un facteur d'authentification ne doit
    // pas être prédictible, même accompagné d'un second.
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '../../src/services/commandes/commande.service.js'),
      'utf8',
    );
    const generateur = source.slice(
      source.indexOf('static _genererReference()'),
      source.indexOf('static async _getFraisLivraison'),
    );
    expect(generateur).not.toContain('Math.random');
    expect(generateur).toContain('crypto.randomInt');
  });
});
