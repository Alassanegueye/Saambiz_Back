/**
 * Ce que répond l'API quand le code à six chiffres ne part pas.
 *
 * Toute panne d'envoi répondait 400 « Le code n'a pas pu être envoyé.
 * Vérifiez l'adresse saisie et réessayez. » Or la cause est presque toujours
 * chez nous : clé Resend absente ou révoquée, domaine d'expédition non
 * vérifié, quota épuisé. La personne allait donc corriger une adresse
 * parfaitement correcte, pendant que rien, ni dans l'application ni dans la
 * supervision, ne signalait que le service d'envoi était à terre.
 *
 * Un 503 le dit, et l'application mobile le traduit déjà par « Le service est
 * momentanément indisponible. »
 */

const mockEnvoyer = jest.fn();

jest.mock('../../src/services/resend.service', () => ({
  sendVerificationEmail: (...a) => mockEnvoyer(...a),
}));

jest.mock('../../src/models', () => ({
  VerificationEmail: {
    findByPk: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue(undefined),
  },
  Utilisateur: { findOne: jest.fn().mockResolvedValue(null) },
}));

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const InscriptionService = require('../../src/services/inscription.service');

/** Tente un envoi dont Resend échoue avec ce message, et rend l'erreur levée. */
async function echecAvec(message) {
  mockEnvoyer.mockRejectedValueOnce(new Error(message));
  try {
    await InscriptionService.envoyerCode('client@exemple.sn');
    throw new Error('un échec était attendu');
  } catch (err) {
    return err;
  }
}

beforeEach(() => jest.clearAllMocks());

describe('La panne vient de notre configuration', () => {
  // Les libellés réels de Resend sur les trois pannes les plus courantes.
  const pannes = [
    ['domaine non vérifié', 'The send.saambiz.com domain is not verified'],
    ['clé révoquée', 'API key is invalid'],
    ['quota épuisé', 'Daily quota exceeded'],
    ['clé absente', 'Service e-mail non configuré (RESEND_API_KEY manquante).'],
  ];

  test.each(pannes)('%s → 503, et l’adresse n’est pas mise en cause', async (_, message) => {
    const err = await echecAvec(message);
    expect(err.status).toBe(503);
    expect(err.message).toMatch(/indisponible/i);
    expect(err.message).not.toMatch(/adresse/i);
  });

  test('un message inconnu penche du côté de la panne', async () => {
    // Une adresse malformée est écartée bien avant par estEmailValide : si
    // Resend refuse sans nommer le destinataire, c'est nous.
    const err = await echecAvec('something went wrong');
    expect(err.status).toBe(503);
  });

  test('la cause exacte atteint les journaux', async () => {
    const logger = require('../../src/utils/logger');
    await echecAvec('The send.saambiz.com domain is not verified');
    const [titre, meta] = logger.error.mock.calls.at(-1);
    expect(titre).toMatch(/envoi du code impossible/);
    expect(meta.message).toMatch(/not verified/);
  });
});

describe('Resend met le destinataire en cause', () => {
  test('l’adresse est alors signalée, en 400', async () => {
    const err = await echecAvec('Invalid `to` field. Please use a valid email address.');
    expect(err.status).toBe(400);
    expect(err.message).toMatch(/adresse/i);
  });
});

describe('Quand l’envoi passe', () => {
  test('aucune erreur, et le message nomme l’adresse', async () => {
    mockEnvoyer.mockResolvedValueOnce({ id: 'msg_1' });
    const resultat = await InscriptionService.envoyerCode('client@exemple.sn');
    expect(resultat.message).toContain('client@exemple.sn');
    expect(mockEnvoyer).toHaveBeenCalledTimes(1);
  });
});
