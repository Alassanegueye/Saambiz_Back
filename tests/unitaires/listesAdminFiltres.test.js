/**
 * Les clauses que construit l'administration pour ses listes de comptes.
 *
 * Ce sont des objets `where` : ils ne touchent pas la base, mais ils
 * décident de ce que le back-office voit. Deux règles y sont figées.
 *
 * 1. Un compte supprimé par son titulaire n'est ni actif ni suspendu. Tant
 *    qu'on les confondait, l'administration proposait « Réactiver » sur un
 *    compte que l'API refuse de connecter de toute façon.
 * 2. Les caractères `%` et `_` saisis dans la recherche sont échappés.
 *    Sans cela, chercher « 100% » ramenait la table entière — et sur une
 *    liste paginée, l'administrateur n'aurait vu que les dix premières
 *    lignes de ce tout, sans savoir qu'il les voyait toutes.
 */
const { Op } = require('sequelize');
const AdminService = require('../../src/services/admin/admin.service');

describe('Filtre d’état d’un compte', () => {
  it('sépare les trois états', () => {
    expect(AdminService._filtreStatutCompte('actifs'))
      .toEqual({ statut: 'actif', compteSupprime: false });
    expect(AdminService._filtreStatutCompte('inactifs'))
      .toEqual({ statut: 'inactif', compteSupprime: false });
    expect(AdminService._filtreStatutCompte('supprimes'))
      .toEqual({ compteSupprime: true });
  });

  it('ne filtre rien sans demande', () => {
    expect(AdminService._filtreStatutCompte()).toEqual({});
    expect(AdminService._filtreStatutCompte('')).toEqual({});
    expect(AdminService._filtreStatutCompte('inconnu')).toEqual({});
  });

  it('exclut les comptes supprimés des actifs comme des suspendus', () => {
    // La règle qui manquait : sans `compteSupprime: false`, un compte parti
    // continuait de grossir l'un des deux compteurs.
    for (const statut of ['actifs', 'inactifs']) {
      expect(AdminService._filtreStatutCompte(statut).compteSupprime).toBe(false);
    }
  });
});

describe('Clause de recherche', () => {
  const champs = ['nom', 'prenom'];

  it('ne cherche rien sur un terme vide', () => {
    expect(AdminService._recherche('', champs)).toEqual({});
    expect(AdminService._recherche('   ', champs)).toEqual({});
    expect(AdminService._recherche(undefined, champs)).toEqual({});
  });

  it('cherche dans chaque champ, sans tenir compte de la casse', () => {
    const clause = AdminService._recherche('diop', champs);
    expect(clause[Op.or]).toHaveLength(2);
    expect(clause[Op.or][0].nom[Op.iLike]).toBe('%diop%');
    expect(clause[Op.or][1].prenom[Op.iLike]).toBe('%diop%');
  });

  it('échappe les jokers saisis par l’utilisateur', () => {
    expect(AdminService._recherche('100%', champs)[Op.or][0].nom[Op.iLike])
      .toBe('%100\\%%');
    expect(AdminService._recherche('a_b', champs)[Op.or][0].nom[Op.iLike])
      .toBe('%a\\_b%');
  });
});
