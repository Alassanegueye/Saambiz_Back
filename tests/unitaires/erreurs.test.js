const errorHandler = require('../../src/middlewares/errorHandler.middleware');
const {
  AppError, BadRequestError, NotFoundError, ConflictError, ValidationError,
} = require('../../src/errors/AppError');

jest.mock('../../src/utils/logger', () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn() }));

/**
 * Traduction des erreurs en réponses HTTP.
 *
 * L'ancien gestionnaire se contentait de lire `err.status` : un doublon, un
 * jeton expiré ou un fichier trop lourd sortaient tous en 500 « Erreur
 * serveur interne », ce qui rendait le diagnostic impossible des deux côtés.
 */

function fausseReponse() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const requete = { method: 'POST', originalUrl: '/saambiz/v1/produits', requestId: 'r1' };

function traiter(err) {
  const res = fausseReponse();
  errorHandler(err, requete, res, jest.fn());
  return {
    statut: res.status.mock.calls[0][0],
    corps: res.json.mock.calls[0][0],
  };
}

describe('hiérarchie AppError', () => {
  test('chaque classe porte son code HTTP', () => {
    expect(new BadRequestError().status).toBe(400);
    expect(new NotFoundError().status).toBe(404);
    expect(new ConflictError().status).toBe(409);
    expect(new ValidationError().status).toBe(422);
  });

  test('les erreurs applicatives sont marquées opérationnelles', () => {
    // C'est ce drapeau qui distingue ce qu'on a prévu de ce qu'on subit.
    expect(new NotFoundError().isOperational).toBe(true);
  });

  test('ValidationError transporte le détail par champ', () => {
    const err = new ValidationError('Formulaire invalide', [{ champ: 'prix', message: 'requis' }]);
    expect(err.details).toHaveLength(1);
  });
});

describe('errorHandler', () => {
  test('relaie une AppError avec son message', () => {
    const { statut, corps } = traiter(new NotFoundError('Boutique introuvable.'));
    expect(statut).toBe(404);
    expect(corps).toEqual({ success: false, message: 'Boutique introuvable.' });
  });

  test('joint les détails de validation', () => {
    const { statut, corps } = traiter(
      new ValidationError('Champs invalides', [{ champ: 'prix', message: 'requis' }])
    );
    expect(statut).toBe(422);
    expect(corps.details).toHaveLength(1);
  });

  describe('erreurs Sequelize', () => {
    test('contrainte d\'unicité → 409', () => {
      const err = new Error('duplicate key');
      err.name = 'SequelizeUniqueConstraintError';
      err.errors = [{ path: 'email' }];

      const { statut, corps } = traiter(err);
      expect(statut).toBe(409);
      expect(corps.message).toContain('email');
    });

    test('validation de modèle → 422', () => {
      const err = new Error('notNull');
      err.name = 'SequelizeValidationError';
      err.errors = [{ path: 'nom', message: 'ne peut être vide' }];

      const { statut, corps } = traiter(err);
      expect(statut).toBe(422);
      expect(corps.details[0].champ).toBe('nom');
    });

    test('clé étrangère → 400', () => {
      const err = new Error('violates foreign key');
      err.name = 'SequelizeForeignKeyConstraintError';
      expect(traiter(err).statut).toBe(400);
    });

    test('base injoignable → 503', () => {
      const err = new Error('connection refused');
      err.name = 'SequelizeConnectionRefusedError';
      expect(traiter(err).statut).toBe(503);
    });
  });

  describe('erreurs de jeton', () => {
    test('jeton expiré → 401 avec un message actionnable', () => {
      const err = new Error('jwt expired');
      err.name = 'TokenExpiredError';

      const { statut, corps } = traiter(err);
      expect(statut).toBe(401);
      expect(corps.message).toMatch(/reconnectez-vous/i);
    });

    test('jeton malformé → 401', () => {
      const err = new Error('invalid signature');
      err.name = 'JsonWebTokenError';
      expect(traiter(err).statut).toBe(401);
    });
  });

  describe('erreurs de téléversement', () => {
    test('fichier trop lourd → 413', () => {
      const err = new Error('File too large');
      err.name = 'MulterError';
      err.code = 'LIMIT_FILE_SIZE';

      const { statut, corps } = traiter(err);
      expect(statut).toBe(413);
      expect(corps.message).toMatch(/volumineux/i);
    });

    test('champ de fichier inattendu → 413 en nommant le champ', () => {
      const err = new Error('Unexpected field');
      err.name = 'MulterError';
      err.code = 'LIMIT_UNEXPECTED_FILE';
      err.field = 'avatar';

      expect(traiter(err).corps.message).toContain('avatar');
    });
  });

  test('JSON malformé → 400', () => {
    const err = new SyntaxError('Unexpected token');
    err.body = '{bad';
    expect(traiter(err).statut).toBe(400);
  });

  test('corps trop volumineux → 413', () => {
    const err = new Error('request entity too large');
    err.type = 'entity.too.large';
    expect(traiter(err).statut).toBe(413);
  });

  describe('fuite d\'information', () => {
    const env = process.env.NODE_ENV;
    afterEach(() => { process.env.NODE_ENV = env; });

    test('masque le message des erreurs serveur en production', () => {
      // Un message Sequelize brut nomme les tables, les colonnes, parfois
      // les valeurs. Il n'a rien à faire dans une réponse HTTP.
      process.env.NODE_ENV = 'production';
      jest.resetModules();
      const handlerProd = require('../../src/middlewares/errorHandler.middleware');

      const res = fausseReponse();
      handlerProd(new Error('relation "utilisateur" does not exist'), requete, res, jest.fn());

      expect(res.json.mock.calls[0][0].message).toBe('Erreur serveur interne.');
    });

    test('laisse passer le message des erreurs opérationnelles', () => {
      process.env.NODE_ENV = 'production';
      jest.resetModules();
      const handlerProd = require('../../src/middlewares/errorHandler.middleware');

      const res = fausseReponse();
      handlerProd(new AppError('Stock insuffisant.', 409), requete, res, jest.fn());

      expect(res.json.mock.calls[0][0].message).toBe('Stock insuffisant.');
    });
  });
});
