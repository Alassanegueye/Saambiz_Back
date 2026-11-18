/**
 * Pièces d'identité en attente de certification : le back-office reçoit un
 * lien signé à la place de la clé privée, et une ancienne URL publique
 * (Cloudinary) telle quelle.
 */
const mockFindAll = jest.fn();
jest.mock('../../src/models', () => ({
  Utilisateur: { findAll: (...a) => mockFindAll(...a) },
  Produit: {},
  Categorie: {},
  Abonnement: {},
  Paiement: {},
  Boutique: {},
  Signalement: {},
  Notification: {},
  Commande: {},
  LigneCommande: {},
}));
jest.mock('../../src/config/db', () => ({
  transaction: jest.fn(),
  define: jest.fn(() => ({})),
}));
jest.mock('../../src/services/resend.service', () => ({
  sendAccesUtilisateurEmail: jest.fn(),
  sendCertificationEmail: jest.fn(),
}));
jest.mock('../../src/services/stockage/upload.service', () => ({
  urlLecture: jest.fn(async (v) => (v && v.startsWith('prive:') ? `https://signe.test/${v.slice(6)}` : v)),
}));

const AdminService = require('../../src/services/admin/admin.service');

test('les pièces privées deviennent des liens signés, les anciennes URL restent', async () => {
  mockFindAll.mockResolvedValue([{
    toJSON: () => ({
      id: 'v1',
      pieceIdentite: 'prive:certifications/2026/11/recto.jpg',
      pieceIdentiteVerso: 'https://res.cloudinary.com/x/image/upload/v1/saambiz/verso.jpg',
      boutiques: [],
    }),
  }]);

  const { vendeurs } = await AdminService.vendeursAValider();

  expect(vendeurs[0].pieceIdentite).toBe('https://signe.test/certifications/2026/11/recto.jpg');
  expect(vendeurs[0].pieceIdentiteVerso).toBe('https://res.cloudinary.com/x/image/upload/v1/saambiz/verso.jpg');
});
