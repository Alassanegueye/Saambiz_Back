/**
 * Photos du haut du site d'une boutique.
 *
 * Ce qui compte : la liste ne dépasse jamais dix photos, même quand deux
 * ajouts se croisent ; une photo qui n'a pas pu entrer ne reste pas chez
 * l'hébergeur ; l'ordre choisi par le vendeur ne fait jamais disparaître
 * une photo ; et le site public ne montre que des adresses https.
 */
jest.mock('../../src/services/stockage/upload.service', () => ({
  uploadImage: jest.fn(),
  deleteImage: jest.fn().mockResolvedValue(undefined),
  estImageMatricielle: jest.fn(),
}));
const { uploadImage, deleteImage } = require('../../src/services/stockage/upload.service');
const VendeurService = require('../../src/services/vendeurs/vendeur.service');
const VitrineService = require('../../src/services/vitrine/vitrine.service');
const sequelize = require('../../src/config/db');
const { Boutique } = require('../../src/models');

const photo = (n) => ({ id: `p${n}`, url: `https://res.cloudinary.com/x/image/upload/v1/saambiz/${n}.jpg` });
const fichier = () => ({ buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]) });

/** Une boutique en mémoire : `findOne` la relit, `update` l'écrit. */
function boutiqueEnMemoire(photos) {
  const b = { id: 'b1', vitrinePhotos: photos };
  b.update = jest.fn(async (v) => Object.assign(b, v));
  jest.spyOn(Boutique, 'findOne').mockImplementation(async () => b);
  return b;
}

let compteur = 0;
beforeEach(() => {
  jest.restoreAllMocks();
  uploadImage.mockReset().mockImplementation(async () => `https://res.cloudinary.com/x/image/upload/v1/saambiz/n${compteur++}.jpg`);
  deleteImage.mockClear();
  jest.spyOn(sequelize, 'transaction').mockImplementation(async (fn) => fn({ LOCK: { UPDATE: 'UPDATE' } }));
  jest.spyOn(VendeurService, 'maVitrine').mockResolvedValue({ vitrine: {} });
});

describe('Ajout de photos', () => {
  it('ajoute les photos à la fin du défilé, chacune avec son identifiant', async () => {
    const b = boutiqueEnMemoire([photo(1)]);
    const r = await VendeurService.ajouterPhotosVitrine('v1', [fichier(), fichier()]);
    expect(b.vitrinePhotos).toHaveLength(3);
    expect(b.vitrinePhotos[0]).toEqual(photo(1));
    expect(new Set(b.vitrinePhotos.map((p) => p.id)).size).toBe(3);
    expect(r.message).toBe('2 photos ajoutées à votre site.');
  });

  it('s\'arrête à dix photos et dit pourquoi le reste n\'est pas entré', async () => {
    const b = boutiqueEnMemoire(Array.from({ length: 8 }, (_, i) => photo(i)));
    const r = await VendeurService.ajouterPhotosVitrine('v1', [fichier(), fichier(), fichier(), fichier()]);
    expect(b.vitrinePhotos).toHaveLength(10);
    expect(uploadImage).toHaveBeenCalledTimes(2); // les deux de trop ne partent même pas
    expect(r.message).toMatch(/2 n'ont pas été ajoutées : 10 photos au plus/);
  });

  it('refuse d\'emblée quand le défilé est plein', async () => {
    boutiqueEnMemoire(Array.from({ length: 10 }, (_, i) => photo(i)));
    await expect(VendeurService.ajouterPhotosVitrine('v1', [fichier()])).rejects.toThrow(/déjà 10 photos/);
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('garde les photos envoyées quand une autre échoue, et le signale', async () => {
    const b = boutiqueEnMemoire([]);
    uploadImage.mockResolvedValueOnce('https://res.cloudinary.com/x/a.jpg').mockRejectedValueOnce(new Error('panne'));
    const r = await VendeurService.ajouterPhotosVitrine('v1', [fichier(), fichier()]);
    expect(b.vitrinePhotos.map((p) => p.url)).toEqual(['https://res.cloudinary.com/x/a.jpg']);
    expect(r.message).toMatch(/1 n'a pas pu être envoyée/);
  });

  it('ne laisse rien chez l\'hébergeur quand un ajout concurrent a pris la place', async () => {
    const b = boutiqueEnMemoire(Array.from({ length: 9 }, (_, i) => photo(i)));
    // Pendant l'envoi, un autre appareil remplit la dernière place.
    uploadImage.mockImplementation(async () => {
      b.vitrinePhotos = [...b.vitrinePhotos, photo(99)];
      return 'https://res.cloudinary.com/x/tard.jpg';
    });
    await expect(VendeurService.ajouterPhotosVitrine('v1', [fichier()])).rejects.toThrow(/déjà 10 photos/);
    expect(deleteImage).toHaveBeenCalledWith('https://res.cloudinary.com/x/tard.jpg');
    expect(b.vitrinePhotos).toHaveLength(10);
  });

  it('demande au moins une photo', async () => {
    boutiqueEnMemoire([]);
    await expect(VendeurService.ajouterPhotosVitrine('v1', [])).rejects.toThrow(/au moins une photo/);
  });
});

describe('Retrait et ordre', () => {
  it('retire la photo de la liste puis de l\'hébergeur', async () => {
    const b = boutiqueEnMemoire([photo(1), photo(2)]);
    await VendeurService.supprimerPhotoVitrine('v1', 'p1');
    expect(b.vitrinePhotos).toEqual([photo(2)]);
    expect(deleteImage).toHaveBeenCalledWith(photo(1).url);
  });

  it('vide la colonne quand la dernière photo part', async () => {
    const b = boutiqueEnMemoire([photo(1)]);
    await VendeurService.supprimerPhotoVitrine('v1', 'p1');
    expect(b.vitrinePhotos).toBeNull();
  });

  it('répond « introuvable » pour une photo déjà retirée', async () => {
    boutiqueEnMemoire([photo(1)]);
    await expect(VendeurService.supprimerPhotoVitrine('v1', 'pX')).rejects.toThrow(/déjà été retirée/);
    expect(deleteImage).not.toHaveBeenCalled();
  });

  it('range dans l\'ordre reçu sans jamais perdre une photo absente de la liste', async () => {
    const b = boutiqueEnMemoire([photo(1), photo(2), photo(3)]);
    await VendeurService.ordonnerPhotosVitrine('v1', ['p3', 'inconnue', 'p1', 'p3']);
    expect(b.vitrinePhotos.map((p) => p.id)).toEqual(['p3', 'p1', 'p2']);
  });

  it('refuse un ordre qui n\'est pas une liste', async () => {
    boutiqueEnMemoire([photo(1)]);
    await expect(VendeurService.ordonnerPhotosVitrine('v1', 'p1')).rejects.toThrow(/invalide/);
  });
});

describe('Site public', () => {
  it('n\'expose que les adresses https, dans l\'ordre', () => {
    const b = VitrineService._exposerBoutique({
      vitrinePhotos: [photo(2), { id: 'x', url: 'javascript:alert(1)' }, photo(1), null],
    });
    expect(b.photos).toEqual([photo(2).url, photo(1).url]);
  });

  it('renvoie une liste vide sans photo', () => {
    expect(VitrineService._exposerBoutique({}).photos).toEqual([]);
  });
});
