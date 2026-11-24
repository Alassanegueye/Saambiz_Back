/**
 * Vitrine — les règles qui ne dépendent pas de la base.
 *
 * Trois choses se cassent silencieusement dans ce service et ne se voient
 * qu'en production, sur le site d'un vendeur :
 *   - un numéro saisi sous une autre forme ouvre un second compte au même
 *     client, et son historique se scinde en deux ;
 *   - un prix soldé affiché mais pas facturé ;
 *   - une donnée du vendeur qui sort dans une réponse publique.
 * D'où ces tests, qui ne touchent pas PostgreSQL.
 */
const VitrineService = require('../../src/services/vitrine/vitrine.service');

describe('Normalisation des numéros de téléphone', () => {
  it('ramène toutes les écritures d\'un même numéro sénégalais à une seule', () => {
    const attendu = '+221771234567';
    for (const saisie of [
      '771234567',
      '77 123 45 67',
      '77-123-45-67',
      '+221771234567',
      '+221 77 123 45 67',
      '00221771234567',
      '221771234567',
    ]) {
      expect(VitrineService.normaliserTelephone(saisie)).toBe(attendu);
    }
  });

  it('laisse intact un numéro étranger déjà au format international', () => {
    expect(VitrineService.normaliserTelephone('+33612345678')).toBe('+33612345678');
  });

  it('refuse ce qui n\'est pas un numéro exploitable', () => {
    for (const mauvais of ['', null, undefined, 'bonjour', '12', '7712345']) {
      const t = VitrineService.normaliserTelephone(mauvais);
      expect(VitrineService.estTelephoneValide(t)).toBe(false);
    }
  });

  it('accepte un numéro sénégalais normalisé', () => {
    expect(VitrineService.estTelephoneValide('+221771234567')).toBe(true);
  });
});

describe('Prix facturé', () => {
  it('facture le prix soldé quand il est renseigné et inférieur', () => {
    expect(VitrineService.prixEffectif({ prix: '10000', prix_promo: '7500' })).toBe(7500);
  });

  it('ignore un prix promo absent, nul ou supérieur au prix', () => {
    expect(VitrineService.prixEffectif({ prix: '10000', prix_promo: null })).toBe(10000);
    expect(VitrineService.prixEffectif({ prix: '10000', prix_promo: '0' })).toBe(10000);
    expect(VitrineService.prixEffectif({ prix: '10000', prix_promo: '12000' })).toBe(10000);
  });
});

describe('Ce qu\'un produit publie', () => {
  const base = {
    id: 'p1', nom: 'Boubou brodé', description: 'Coton', prix: '20000',
    prix_promo: '15000', image: 'u.jpg', quantite: 2, disponible: true,
    categorieId: 'c1', createdAt: new Date(),
  };

  it('sépare le prix payé du prix barré et calcule la remise', () => {
    const p = VitrineService._exposerProduit(base);
    expect(p.prix).toBe(15000);
    expect(p.prixBarre).toBe(20000);
    expect(p.remise).toBe(25);
  });

  it('n\'annonce ni prix barré ni remise hors promotion', () => {
    const p = VitrineService._exposerProduit({ ...base, prix_promo: null });
    expect(p.prix).toBe(20000);
    expect(p.prixBarre).toBeNull();
    expect(p.remise).toBe(0);
  });

  it('signale un stock faible sans publier la quantité exacte', () => {
    const p = VitrineService._exposerProduit(base);
    expect(p.stockFaible).toBe(true);
    expect(p.quantite).toBeUndefined();
  });

  it('marque indisponible un produit en rupture même déclaré disponible', () => {
    const p = VitrineService._exposerProduit({ ...base, quantite: 0 });
    expect(p.disponible).toBe(false);
  });
});

describe('Ce qu\'une boutique publie', () => {
  const base = {
    id: 'b1', slug: 'chez-fatou', nom: 'Chez Fatou', logo: null,
    couleur_theme: '#1B3A6B',
    vendeur: { nom: 'Diop', prenom: 'Fatou', statutValidation: 'approuve', email: 'secret@x.sn' },
  };

  it('retombe sur la mise en page classique si la valeur stockée est inconnue', () => {
    const b = VitrineService._exposerBoutique({ ...base, vitrineModele: 'n-importe-quoi' });
    expect(b.theme.modele).toBe('classique');
  });

  it('utilise couleur_theme tant que la vitrine n\'a pas sa propre couleur', () => {
    expect(VitrineService._exposerBoutique(base).theme.accent).toBe('#1B3A6B');
    expect(
      VitrineService._exposerBoutique({ ...base, vitrineAccent: '#F2B705' }).theme.accent
    ).toBe('#F2B705');
  });

  it('tire le badge « vérifiée » de la validation du vendeur, pas d\'un réglage', () => {
    expect(VitrineService._exposerBoutique(base).verifiee).toBe(true);
    expect(
      VitrineService._exposerBoutique({ ...base, vendeur: { ...base.vendeur, statutValidation: 'en_attente' } }).verifiee
    ).toBe(false);
  });

  it('ne laisse pas sortir l\'email du vendeur', () => {
    const b = VitrineService._exposerBoutique(base);
    expect(JSON.stringify(b)).not.toContain('secret@x.sn');
    expect(b.vendeur.email).toBeUndefined();
  });

  it('allume toutes les sections tant que le vendeur n\'en a éteint aucune', () => {
    const b = VitrineService._exposerBoutique(base);
    // Liste exhaustive, volontairement : ajouter une section au service fait
    // échouer ce test, ce qui oblige à décider sciemment de son défaut. Une
    // section qui s'allumerait toute seule sur la vitrine de tous les
    // vendeurs, sans que personne ne l'ait voulu, passerait sinon inaperçue.
    expect(b.theme.sections).toEqual({
      apropos:    true,
      categories: true,
      avis:       true,
      contact:    true,
      nouveautes: true,
      meilleures: true,
    });
  });

  it('respecte une section explicitement éteinte', () => {
    const b = VitrineService._exposerBoutique({ ...base, vitrineSections: { avis: false } });
    expect(b.theme.sections.avis).toBe(false);
    expect(b.theme.sections.contact).toBe(true);
  });

  it('ouvre la caisse par défaut et la ferme sur demande', () => {
    expect(VitrineService._exposerBoutique(base).commandeActivee).toBe(true);
    expect(VitrineService._exposerBoutique({ ...base, vitrineCommande: false }).commandeActivee).toBe(false);
  });
});

/**
 * L'EMAIL EST DEVENU OBLIGATOIRE À LA COMMANDE.
 *
 * Il était facultatif, et le commentaire du service disait pourquoi :
 * l'exiger fait abandonner des commandes. Ce raisonnement tenait tant que le
 * suivi passait par la référence et le téléphone. Depuis que le client reçoit
 * un lien unique — le seul moyen qu'il a de revenir voir sa commande, et de
 * recevoir chaque changement d'étape — une commande sans adresse est une
 * commande que personne ne pourra suivre.
 */
describe('Coordonnées du client à la commande', () => {
  const valides = { nom: 'Fall', prenom: 'Awa', telephone: '77 123 45 67' };

  it('refuse une commande sans adresse email', () => {
    expect(() => VitrineService._preparerClient(valides))
      .toThrow(/adresse email/i);
    expect(() => VitrineService._preparerClient({ ...valides, email: '   ' }))
      .toThrow(/adresse email/i);
  });

  it('refuse une adresse qui n’en est pas une, et le dit simplement', () => {
    expect(() => VitrineService._preparerClient({ ...valides, email: 'awa@@exemple' }))
      .toThrow(/ne semble pas valide/i);
  });

  it('accepte une adresse valide et la normalise', () => {
    const client = VitrineService._preparerClient({ ...valides, email: '  AWA@Exemple.SN ' });
    expect(client.email).toBe('awa@exemple.sn');
  });

  it('continue d’exiger le nom, le prénom et un numéro joignable', () => {
    expect(() => VitrineService._preparerClient({ ...valides, prenom: 'A', email: 'a@b.sn' }))
      .toThrow(/prénom et votre nom/i);
    expect(() => VitrineService._preparerClient({ ...valides, telephone: '123', email: 'a@b.sn' }))
      .toThrow(/téléphone/i);
  });
});
