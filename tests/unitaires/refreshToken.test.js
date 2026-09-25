const jwt = require('jsonwebtoken');

jest.mock('../../src/models', () => ({
  RefreshToken: {
    create: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue([0]),
    destroy: jest.fn().mockResolvedValue(0),
  },
}));
jest.mock('../../src/utils/logger', () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn() }));

const { RefreshToken } = require('../../src/models');
const RefreshTokenService = require('../../src/services/refreshToken.service');
const { jwtConfig } = require('../../src/config/security');

/**
 * Cycle de vie des jetons de rafraîchissement.
 *
 * Avant ce service, un refresh signé pour sept jours restait valable sept
 * jours quoi qu'il arrive : pas de révocation à la déconnexion, pas de
 * plafond de sessions, aucun moyen de couper l'accès d'un appareil perdu.
 */
describe('RefreshTokenService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    RefreshToken.findAll.mockResolvedValue([]);
    RefreshToken.update.mockResolvedValue([0]);
  });

  describe('émission', () => {
    test('signe un jeton et enregistre son empreinte, jamais le jeton', async () => {
      const token = await RefreshTokenService.emettre('utilisateur-1', {
        userAgent: 'Firefox', ip: '10.0.0.1',
      });

      expect(RefreshToken.create).toHaveBeenCalledTimes(1);
      const enregistre = RefreshToken.create.mock.calls[0][0];

      // Le point essentiel : une fuite de la table ne doit donner aucune
      // session utilisable.
      expect(enregistre.tokenHash).toHaveLength(64);
      expect(enregistre.tokenHash).not.toBe(token);
      expect(JSON.stringify(enregistre)).not.toContain(token);
    });

    test('le jeton émis est vérifiable avec le secret de rafraîchissement', async () => {
      const token = await RefreshTokenService.emettre('utilisateur-1');
      expect(jwt.verify(token, jwtConfig.refreshSecret).id).toBe('utilisateur-1');
    });

    test("conserve le contexte d'appareil", async () => {
      await RefreshTokenService.emettre('u1', { userAgent: 'Chrome', ip: '1.2.3.4' });
      const enregistre = RefreshToken.create.mock.calls[0][0];
      expect(enregistre.userAgent).toBe('Chrome');
      expect(enregistre.adresseIp).toBe('1.2.3.4');
    });

    test('révoque les sessions les plus anciennes au-delà du plafond', async () => {
      // Six sessions actives pour un plafond de cinq : la plus ancienne tombe.
      const sessions = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}` }));
      RefreshToken.findAll.mockResolvedValue(sessions);

      await RefreshTokenService.emettre('u1');

      expect(RefreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({ revokedAt: expect.any(Date) }),
        expect.objectContaining({ where: { id: ['s5'] } })
      );
    });
  });

  describe('vérification', () => {
    test('refuse un jeton dont la signature ne tient pas', async () => {
      const resultat = await RefreshTokenService.verifier('pas.un.jeton');
      expect(resultat.valide).toBe(false);
    });

    test('refuse un jeton signé mais absent de la base', async () => {
      // Signature valide + absent de la table = révoqué. C'est ce qui rend
      // la déconnexion réellement effective.
      const token = jwt.sign({ id: 'u1' }, jwtConfig.refreshSecret, { expiresIn: '7d' });
      RefreshToken.findOne.mockResolvedValue(null);

      const resultat = await RefreshTokenService.verifier(token);
      expect(resultat.valide).toBe(false);
      expect(resultat.motif).toMatch(/reconnectez-vous/i);
    });

    test('refuse un jeton révoqué', async () => {
      const token = jwt.sign({ id: 'u1' }, jwtConfig.refreshSecret, { expiresIn: '7d' });
      RefreshToken.findOne.mockResolvedValue({
        revokedAt: new Date(), expiresAt: new Date(Date.now() + 86400000),
      });

      expect((await RefreshTokenService.verifier(token)).valide).toBe(false);
    });

    test('accepte un jeton actif', async () => {
      const token = jwt.sign({ id: 'u1' }, jwtConfig.refreshSecret, { expiresIn: '7d' });
      RefreshToken.findOne.mockResolvedValue({
        revokedAt: null, expiresAt: new Date(Date.now() + 86400000),
      });

      const resultat = await RefreshTokenService.verifier(token);
      expect(resultat.valide).toBe(true);
      expect(resultat.utilisateurId).toBe('u1');
    });

    test("un jeton d'accès ne passe pas pour un refresh", async () => {
      // Le test qui justifie d'avoir trois secrets distincts.
      const jetonAcces = jwt.sign({ id: 'u1' }, jwtConfig.secret, { expiresIn: '1h' });
      expect((await RefreshTokenService.verifier(jetonAcces)).valide).toBe(false);
    });
  });

  describe('rotation', () => {
    test('révoque l\'ancien jeton et en émet un neuf', async () => {
      const ancien = jwt.sign({ id: 'u1' }, jwtConfig.refreshSecret, { expiresIn: '7d' });
      const enregistrement = {
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
        update: jest.fn().mockResolvedValue(true),
      };
      RefreshToken.findOne.mockResolvedValue(enregistrement);

      const resultat = await RefreshTokenService.faireTourner(ancien, {});

      expect(enregistrement.update).toHaveBeenCalledWith(
        expect.objectContaining({ revokedAt: expect.any(Date) })
      );
      expect(resultat.valide).toBe(true);
      expect(resultat.token).not.toBe(ancien);
    });

    test('un jeton déjà utilisé ne repasse pas', async () => {
      // Présenté deux fois, la seconde tentative échoue : c'est ce qui rend
      // un vol visible au lieu de le laisser passer inaperçu.
      const token = jwt.sign({ id: 'u1' }, jwtConfig.refreshSecret, { expiresIn: '7d' });
      RefreshToken.findOne.mockResolvedValue({
        revokedAt: new Date(), expiresAt: new Date(Date.now() + 86400000),
      });

      expect((await RefreshTokenService.faireTourner(token, {})).valide).toBe(false);
    });
  });

  describe('révocation', () => {
    test('révoque toutes les sessions d\'un compte', async () => {
      RefreshToken.update.mockResolvedValue([3]);
      expect(await RefreshTokenService.revoquerTout('u1')).toBe(3);
    });

    test('ne révoque pas deux fois le même jeton', async () => {
      await RefreshTokenService.revoquer('un-jeton');
      expect(RefreshToken.update.mock.calls[0][1].where.revokedAt).toBeNull();
    });
  });
});
