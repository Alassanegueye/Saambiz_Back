const { paginate, metaPagination, LIMITE_MAX } = require('../../src/utils/paginate');
const { passwordSchema, loginSchema } = require('../../src/validators/auth.validator');

/**
 * Pagination et validation des entrées.
 *
 * La borne haute de la pagination est le point important : sans elle,
 * `?limit=100000` fait charger une table entière en mémoire, la sérialiser et
 * l'envoyer. C'est un déni de service à une requête, disponible pour n'importe qui.
 */
describe('paginate', () => {
  test('valeurs par défaut', () => {
    const { page, limit, offset } = paginate();
    expect(page).toBe(1);
    expect(offset).toBe(0);
    expect(limit).toBeGreaterThan(0);
  });

  test('calcule le décalage', () => {
    expect(paginate(3, 20).offset).toBe(40);
  });

  test('borne la limite haute', () => {
    expect(paginate(1, 100000).limit).toBe(LIMITE_MAX);
  });

  test('ramène une page négative à 1', () => {
    expect(paginate(-5).page).toBe(1);
  });

  test('ignore une valeur non numérique', () => {
    const { page, limit } = paginate('abc', 'xyz');
    expect(page).toBe(1);
    expect(limit).toBeGreaterThan(0);
  });

  test('refuse une limite nulle', () => {
    expect(paginate(1, 0).limit).toBeGreaterThan(0);
  });

  test('métadonnées cohérentes', () => {
    expect(metaPagination(45, 2, 20)).toEqual({ total: 45, page: 2, limit: 20, pages: 3 });
  });

  test('au moins une page même sans résultat', () => {
    // Une liste vide qui annonce « page 1 sur 0 » casse les pagineurs côté client.
    expect(metaPagination(0, 1, 20).pages).toBe(1);
  });
});

describe('politique de mot de passe', () => {
  const refuse = (mdp) => expect(passwordSchema.validate(mdp).error).toBeDefined();

  test('accepte un mot de passe conforme', () => {
    expect(passwordSchema.validate('MotDePasse1!').error).toBeUndefined();
  });

  test('refuse trop court', () => refuse('Ab1!'));
  test('refuse sans majuscule', () => refuse('motdepasse1!'));
  test('refuse sans chiffre', () => refuse('MotDePasse!'));
  test('refuse sans caractère spécial', () => refuse('MotDePasse1'));
});

describe('schéma de connexion', () => {
  test('accepte un email', () => {
    expect(loginSchema.validate({ email: 'a@b.sn', mot_de_passe: 'x' }).error).toBeUndefined();
  });

  test('accepte un téléphone', () => {
    expect(loginSchema.validate({ telephone: '+221770000000', mot_de_passe: 'x' }).error).toBeUndefined();
  });

  test('exige au moins un identifiant', () => {
    expect(loginSchema.validate({ mot_de_passe: 'x' }).error).toBeDefined();
  });

  test('refuse un champ inconnu', () => {
    // `allowUnknown: false` empêche qu'un client glisse un champ que le
    // service consommerait sans le vouloir — un `role`, par exemple.
    const { error } = loginSchema.validate({ email: 'a@b.sn', mot_de_passe: 'x', role: 'Admin' });
    expect(error).toBeDefined();
  });
});
