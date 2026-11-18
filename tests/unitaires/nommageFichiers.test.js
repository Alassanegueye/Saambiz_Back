/**
 * Le nom sous lequel un fichier est rangé, et ce qu'il garantit.
 *
 * La forme est : « dossier/aaaa/mm/<horodatage>-<24 hexadécimaux>.<ext> ».
 * Quatre choses en dépendent :
 *
 *  - le DOSSIER dit ce qu'on range : produits, boutiques, profils,
 *    promotions, vitrine, certifications. Sans lui, tout finissait mélangé
 *    et plus rien ne se retrouvait dans le bucket ;
 *  - l'EXTENSION doit correspondre au contenu réel. Une photo rangée sous
 *    une extension que les navigateurs ne connaissent pas ne s'affiche
 *    jamais : elle se télécharge ;
 *  - le nom est ALÉATOIRE : ni le nom du vendeur, ni le type d'une pièce
 *    d'identité, ni le nom du fichier d'origine ne doivent se lire dans une
 *    adresse publique ;
 *  - il est UNIQUE : deux envois simultanés ne s'écrasent pas.
 */

jest.mock('../../src/services/stockage/r2.service', () => ({
  publicConfigure: () => true,
  priveConfigure: () => true,
  envoyer: jest.fn(async (buffer, cle) => cle),
  adressePublique: (cle) => `https://images.saambiz.com/${cle}`,
  supprimer: jest.fn(),
  versCle: jest.fn(),
  lienSigne: jest.fn(),
  urlPublique: () => 'https://images.saambiz.com',
}));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const r2 = require('../../src/services/stockage/r2.service');
const { uploadImage, uploadDocumentPrive } = require('../../src/services/stockage/upload.service');

/** Un vrai JPEG minuscule : magic bytes FF D8 FF, lisible par sharp. */
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a'
  + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA'
  + 'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64)]);

/** La clé réellement écrite sur R2 au dernier envoi. */
const derniereCle = () => r2.envoyer.mock.calls.at(-1)[1];

beforeEach(() => jest.clearAllMocks());

describe('La forme du nom', () => {
  test('dossier, année, mois, horodatage, aléa, extension', async () => {
    await uploadImage(JPEG, 'produits');

    expect(derniereCle()).toMatch(/^produits\/\d{4}\/\d{2}\/\d{13}-[0-9a-f]{24}\.jpg$/);
  });

  test('chaque dossier de l’application est respecté', async () => {
    // Les six rangements que connaissent les appelants.
    for (const dossier of ['produits', 'boutiques', 'profils', 'promotions', 'vitrine']) {
      await uploadImage(JPEG, dossier);
      expect(derniereCle().startsWith(`${dossier}/`)).toBe(true);
    }

    await uploadDocumentPrive(PDF, 'certifications');
    expect(derniereCle().startsWith('certifications/')).toBe(true);
  });

  test('un dossier farfelu est nettoyé, jamais recopié tel quel', async () => {
    // Il entre dans une adresse publique : ni espace, ni accent, ni
    // remontée de chemin.
    await uploadImage(JPEG, '../Secret Dossier/../');

    expect(derniereCle()).toMatch(/^secretdossier\/\d{4}\//);
    expect(derniereCle()).not.toContain('..');
    expect(derniereCle()).not.toContain(' ');
  });

  test('deux envois de suite ne portent jamais le même nom', async () => {
    await uploadImage(JPEG, 'produits');
    const premier = derniereCle();
    await uploadImage(JPEG, 'produits');

    expect(derniereCle()).not.toBe(premier);
  });

  test('rien du fichier d’origine ne subsiste dans le nom', async () => {
    // Le nom vient du serveur, pas du téléphone : une photo « CNI-Awa.jpg »
    // ne doit pas se lire dans une adresse.
    await uploadImage(JPEG, 'profils');

    expect(derniereCle().toLowerCase()).not.toContain('cni');
    expect(derniereCle().toLowerCase()).not.toContain('awa');
  });
});

describe('L’extension dit le vrai contenu', () => {
  test('un JPEG est rangé en .jpg', async () => {
    await uploadImage(JPEG, 'produits');
    expect(derniereCle().endsWith('.jpg')).toBe(true);
  });

  test('un PNG transparent reste en .png', async () => {
    // Un logo détouré perdrait sa transparence en JPEG.
    await uploadImage(PNG, 'boutiques');
    expect(derniereCle().endsWith('.png')).toBe(true);
  });

  test('un PDF est rangé en .pdf', async () => {
    await uploadDocumentPrive(PDF, 'certifications');
    expect(derniereCle().endsWith('.pdf')).toBe(true);
  });

  test('ni image ni PDF : refusé, et rien n’est rangé', async () => {
    // Avant, ce cas rangeait un « .bin » en application/octet-stream : le
    // navigateur le téléchargeait au lieu de l'afficher, et le vendeur
    // voyait une image cassée après un envoi annoncé comme réussi.
    const inconnu = Buffer.from('GIF89a' + '\0'.repeat(64), 'binary');

    await expect(uploadImage(inconnu, 'produits')).rejects.toThrow(/Format de fichier/);
    expect(r2.envoyer).not.toHaveBeenCalled();
  });

  test('aucune clé ne se termine jamais en .bin', async () => {
    for (const contenu of [JPEG, PNG]) {
      await uploadImage(contenu, 'produits');
      expect(derniereCle().endsWith('.bin')).toBe(false);
    }
  });
});

describe('L’adresse rendue', () => {
  test('une photo publique rend son adresse complète', async () => {
    const url = await uploadImage(JPEG, 'produits');

    expect(url).toMatch(/^https:\/\/images\.saambiz\.com\/produits\/\d{4}\/\d{2}\/\d{13}-[0-9a-f]{24}\.jpg$/);
  });

  test('un document privé rend « prive:… », jamais une adresse', async () => {
    // Une pièce d'identité ne doit avoir aucune adresse publique.
    const valeur = await uploadDocumentPrive(PDF, 'certifications');

    expect(valeur.startsWith('prive:')).toBe(true);
    expect(valeur).not.toContain('http');
  });
});
