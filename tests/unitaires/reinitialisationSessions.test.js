/**
 * Réinitialiser son mot de passe doit fermer les sessions ouvertes.
 *
 * `changerMotDePasse` le faisait déjà, pour la raison que son propre
 * commentaire donne : on change son mot de passe quand on soupçonne une
 * fuite. Le chemin « mot de passe oublié » ne le faisait PAS — alors que
 * c'est celui qu'emprunte la personne qui a perdu la main sur son compte.
 * Celui qui détenait une session y restait donc connecté après la
 * réinitialisation, et le geste ne reprenait rien.
 */

const bcrypt = require('bcryptjs');

const mockUtilisateurFindOne = jest.fn();
const mockOtpFindOne = jest.fn();
const mockRevoquerTout = jest.fn();
const mockCouperSockets = jest.fn();

jest.mock('../../src/models', () => ({
  Utilisateur: { findOne: (...a) => mockUtilisateurFindOne(...a), findByPk: jest.fn() },
  UserOtp: { findOne: (...a) => mockOtpFindOne(...a), destroy: jest.fn(), create: jest.fn() },
  Boutique: { update: jest.fn() },
  Commande: { findOne: jest.fn() },
  TokenBlacklist: { create: jest.fn() },
  RefreshToken: { destroy: jest.fn() },
}));
jest.mock('../../src/services/refreshToken.service', () => ({
  revoquerTout: (...a) => mockRevoquerTout(...a),
}));
jest.mock('../../src/services/socket.service', () => ({
  couperSocketsUtilisateur: (...a) => mockCouperSockets(...a),
}));
jest.mock('../../src/services/resend.service', () => ({ sendOtpEmail: jest.fn() }));
jest.mock('../../src/services/stockage/upload.service', () => ({ uploadImage: jest.fn() }));
jest.mock('../../src/services/audit.service', () => ({ enregistrer: jest.fn() }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../../src/config/db', () => ({ transaction: jest.fn() }));

const AccountService = require('../../src/services/account.service');

const UID = '22222222-0000-4000-8000-000000000002';
const EMAIL = 'client@example.com';
const CODE = '123456';

describe('resetPassword — fermeture des sessions', () => {
  let utilisateur;

  beforeEach(async () => {
    utilisateur = { id: UID, email: EMAIL, update: jest.fn() };
    mockUtilisateurFindOne.mockReset().mockResolvedValue(utilisateur);
    mockOtpFindOne.mockReset().mockResolvedValue({
      otpHash: await bcrypt.hash(CODE, 4),
      destroy: jest.fn(),
    });
    mockRevoquerTout.mockReset().mockResolvedValue(1);
    mockCouperSockets.mockReset();
  });

  it('révoque toutes les sessions du compte', async () => {
    const r = await AccountService.resetPassword(EMAIL, CODE, 'NouveauMdp1!');

    expect(r.success).toBe(true);
    expect(mockRevoquerTout).toHaveBeenCalledWith(UID);
  });

  it('coupe aussi les connexions temps réel ouvertes', async () => {
    await AccountService.resetPassword(EMAIL, CODE, 'NouveauMdp1!');

    expect(mockCouperSockets).toHaveBeenCalledWith(UID);
  });

  it('ne touche à rien si le code est faux', async () => {
    const r = await AccountService.resetPassword(EMAIL, '000000', 'NouveauMdp1!');

    expect(r.success).toBe(false);
    expect(utilisateur.update).not.toHaveBeenCalled();
    expect(mockRevoquerTout).not.toHaveBeenCalled();
    expect(mockCouperSockets).not.toHaveBeenCalled();
  });
});
