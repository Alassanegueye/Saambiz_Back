/**
 * Où les visites et les vues se comptent, et où elles ne se comptent pas.
 *
 * - Site : la page d'accueil compte une visite, sauf quand le vendeur ouvre
 *   son propre site depuis l'application (`?apercu`).
 * - Application : la page d'une boutique compte une visite parce qu'elle
 *   l'annonce (`X-Visiteur`). La fiche d'une commande relit la même
 *   boutique pour l'afficher, sans l'annoncer : ce n'est pas une visite.
 * - Fiche produit : une vue, une seule. L'application appelait aussi
 *   POST /acheteurs/produit/:id/vue, et chaque ouverture comptait double.
 */

const mockEnregistrer = jest.fn().mockResolvedValue(true);
const mockVueProduit = jest.fn().mockResolvedValue(true);

jest.mock('../../src/services/visites/visite.service', () => {
  const vrai = jest.requireActual('../../src/services/visites/visite.service');
  return {
    identifiantAppareil: vrai.identifiantAppareil,
    enregistrer: (...a) => mockEnregistrer(...a),
    compterVueProduit: (...a) => mockVueProduit(...a),
  };
});
jest.mock('../../src/services/catalogue/catalogue.service', () => ({
  boutique: jest.fn().mockResolvedValue({ boutique: { id: 'b1', vendeurId: 'v1', categorie: 'Mode' } }),
  detail: jest.fn().mockResolvedValue({ produit: { id: 'p1', vendeurId: 'v1', categorie: { nom: 'Mode' } } }),
}));
jest.mock('../../src/services/acheteurs/accueil.service', () => ({
  enregistrerAffinite: jest.fn().mockResolvedValue(),
  enregistrerRecherche: jest.fn().mockResolvedValue(),
}));
jest.mock('../../src/services/vitrine/vitrine.service', () => ({
  accueil: jest.fn().mockResolvedValue({ boutique: { id: 'b1' } }),
  getProduit: jest.fn().mockResolvedValue({ produit: { id: 'p1' } }),
}));
// Les modèles et la base ne sont pas sollicités : le service des visites et
// les services métier sont remplacés ci-dessus.
jest.mock('../../src/config/db', () => ({ define: jest.fn(() => ({})), query: jest.fn() }));
jest.mock('../../src/models', () => ({ Boutique: {}, Produit: {} }));
jest.mock('../../src/models/visiteBoutique.model', () => ({}));

const CatalogueController = require('../../src/controllers/catalogue/catalogue.controller');
const VitrineController = require('../../src/controllers/vitrine/vitrine.controller');

const CHROME = 'Mozilla/5.0 (iPhone) AppleWebKit/605 Safari/604';
const APPAREIL = '0123456789abcdef0123456789abcdef';

const requete = ({ params = {}, query = {}, entetes = {}, user } = {}) => ({
  params,
  query,
  user,
  ip: '41.82.10.5',
  get: (nom) => ({ 'user-agent': CHROME, ...entetes })[nom.toLowerCase()],
});
const reponse = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};
const appeler = (handler, req) => new Promise((resolve, reject) => {
  const res = reponse();
  res.json = jest.fn(() => { resolve(res); return res; });
  handler(req, res, reject);
});

beforeEach(() => {
  mockEnregistrer.mockClear();
  mockVueProduit.mockClear();
});

describe('Site de la boutique', () => {
  it('la page d’accueil compte une visite', async () => {
    await appeler(VitrineController.accueil, requete({ params: { slug: 'footshop-1' } }));
    expect(mockEnregistrer).toHaveBeenCalledWith(expect.objectContaining({
      boutiqueId: 'b1', canal: 'site', ip: '41.82.10.5', userAgent: CHROME,
    }));
  });

  it('le vendeur qui ouvre son site depuis l’application ne compte pas', async () => {
    await appeler(VitrineController.accueil, requete({ params: { slug: 'footshop-1' }, query: { apercu: '1' } }));
    expect(mockEnregistrer).not.toHaveBeenCalled();
  });

  it('une fiche produit du site compte une vue', async () => {
    await appeler(VitrineController.getProduit, requete({ params: { slug: 'footshop-1', produitId: 'p1' } }));
    expect(mockVueProduit).toHaveBeenCalledWith(expect.objectContaining({ produitId: 'p1' }));
  });
});

describe('Application', () => {
  it('la page de la boutique compte une visite, avec l’appareil', async () => {
    await appeler(CatalogueController.boutique, requete({
      params: { id: 'b1' },
      entetes: { 'x-visiteur': APPAREIL.toUpperCase() },
      user: { id: 'u1' },
    }));
    expect(mockEnregistrer).toHaveBeenCalledWith(expect.objectContaining({
      boutiqueId: 'b1', vendeurId: 'v1', canal: 'app', utilisateurId: 'u1', appareil: APPAREIL,
    }));
  });

  it('la fiche d’une commande relit la boutique sans compter de visite', async () => {
    await appeler(CatalogueController.boutique, requete({ params: { id: 'b1' }, user: { id: 'u1' } }));
    expect(mockEnregistrer).not.toHaveBeenCalled();
  });

  it('un identifiant d’appareil invalide ne compte pas', async () => {
    await appeler(CatalogueController.boutique, requete({
      params: { id: 'b1' },
      entetes: { 'x-visiteur': 'n’importe quoi' },
    }));
    expect(mockEnregistrer).not.toHaveBeenCalled();
  });

  it('une fiche produit compte une vue, une seule', async () => {
    await appeler(CatalogueController.detail, requete({ params: { id: 'p1' }, user: { id: 'u1' } }));
    expect(mockVueProduit).toHaveBeenCalledTimes(1);
    expect(mockVueProduit).toHaveBeenCalledWith(expect.objectContaining({
      produitId: 'p1', vendeurId: 'v1', utilisateurId: 'u1',
    }));
  });
});
