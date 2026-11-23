/**
 * Ce que `formatUser` doit laisser passer, et pourquoi.
 *
 * Cette fonction décide de ce que le back-office voit d'un compte. Tant
 * qu'elle taisait `statut`, l'administration n'avait aucun moyen de savoir
 * si un vendeur était actif : elle lisait `undefined`, en concluait « pas
 * actif », et affichait « Suspendu » en rouge pour la totalité des vendeurs
 * — avec le bouton « Réactiver » à la place de « Suspendre », et un filtre
 * « Actifs » qui ne renvoyait jamais personne. Rien dans les journaux, rien
 * d'erreur : juste une liste entière qui mentait.
 *
 * `createdAt` manquait de la même façon, et la colonne « Inscription »
 * n'affichait que des tirets.
 */
const formatUser = require('../../src/utils/formatUser');

const VENDEUR = {
  id: 7,
  nom: 'THIAM',
  prenom: 'Ibnou',
  email: 'ibnou@exemple.sn',
  adresse: 'Dakar',
  telephone: '+221775289114',
  photoProfil: null,
  role: 'Vendeur',
  verifie: true,
  statut: 'actif',
  createdAt: new Date('2026-10-31T10:00:00Z'),
  motDePasse: 'ne doit jamais sortir',
  boutiques: [{ id: 3, nom: 'Logiflex', vitrineActive: true }],
};

describe('formatUser', () => {
  it('expose le statut du compte', () => {
    expect(formatUser(VENDEUR).statut).toBe('actif');
    expect(formatUser({ ...VENDEUR, statut: 'inactif' }).statut).toBe('inactif');
  });

  it('considère un statut absent comme actif, jamais comme suspendu', () => {
    // Le modèle a `actif` pour valeur par défaut : une colonne vide en base
    // n'est pas une suspension, et ne doit pas s'afficher comme telle.
    const sansStatut = { ...VENDEUR };
    delete sansStatut.statut;
    expect(formatUser(sansStatut).statut).toBe('actif');
  });

  it('expose la date d’inscription', () => {
    expect(formatUser(VENDEUR).createdAt).toEqual(VENDEUR.createdAt);
    const sansDate = { ...VENDEUR };
    delete sansDate.createdAt;
    expect(formatUser(sansDate).createdAt).toBeNull();
  });

  it('expose la suppression du compte par son titulaire', () => {
    // Le back-office doit distinguer « supprimé » de « suspendu » : le
    // premier n'est pas réactivable, le second l'est.
    expect(formatUser(VENDEUR).compteSupprime).toBe(false);
    const parti = { ...VENDEUR, compteSupprime: true, dateSuppression: new Date('2026-11-02') };
    expect(formatUser(parti).compteSupprime).toBe(true);
    expect(formatUser(parti).dateSuppression).toEqual(parti.dateSuppression);
  });

  it('ne laisse sortir ni mot de passe ni champ non déclaré', () => {
    const formate = formatUser(VENDEUR);
    expect(formate.motDePasse).toBeUndefined();
    expect(Object.keys(formate).sort()).toEqual([
      'adresse', 'boutiques', 'compteSupprime', 'createdAt', 'dateSuppression',
      'email', 'id', 'nom', 'photoProfil', 'prenom', 'role', 'statut',
      'telephone', 'verifie',
    ]);
  });

  it('ne joint la boutique qu’aux vendeurs', () => {
    expect(formatUser(VENDEUR).boutiques).toHaveLength(1);
    expect(formatUser({ ...VENDEUR, role: 'Acheteur' }).boutiques).toBeUndefined();
  });
});
