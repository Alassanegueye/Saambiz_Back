/**
 * Ce que le vendeur obtient quand il demande un statut.
 *
 * Deux defauts se repondaient. Les boutons de l'application restaient
 * cliquables pendant la requete, donc un deuxieme appui partait avant le
 * retour du premier ; et le serveur repondait a ce doublon
 * « Transition impossible : acceptee → acceptee ». Le vendeur voyait une
 * erreur technique pour une commande qu'il venait pourtant d'accepter, sur un
 * ecran qui affichait encore « en attente ».
 *
 * Le mobile neutralise desormais ses boutons (test double_appui_test.dart).
 * Ici, le serveur fait sa part : une demande deja satisfaite n'est pas une
 * erreur, et un refus se lit.
 */

const mockFindByPk = jest.fn();
const mockSave = jest.fn();

jest.mock('../../src/models', () => ({
  Commande: { findByPk: (...a) => mockFindByPk(...a) },
  LigneCommande: {},
  Produit: {},
  Utilisateur: {},
  Boutique: {},
}));
jest.mock('../../src/config/db', () => ({
  transaction: jest.fn(),
  define: jest.fn(() => ({})),
}));
jest.mock('../../src/services/notifications/notification.service', () => ({
  creerNotification: jest.fn(),
  notifierUtilisateurs: jest.fn(),
  notifierAbonnesBoutique: jest.fn(),
}));
jest.mock('../../src/services/resend.service', () => ({
  sendNouvelleCommandeEmail: jest.fn(),
  sendCommandeClientEmail: jest.fn(),
}));
jest.mock('../../src/services/socket.service', () => ({
  getIO: () => ({ to: () => ({ emit: jest.fn() }) }),
}));

const CommandeService = require('../../src/services/commandes/commande.service');

const VENDEUR = 'vendeur-1';

/** Une commande en base, dans l'etat donne. */
function commandeEn(statut) {
  return {
    id: 'cmd-1',
    statut,
    statutPaiement: 'non_paye',
    modePaiement: 'a_la_livraison',
    acheteurId: 'acheteur-1',
    vendeurId: VENDEUR,
    save: mockSave,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSave.mockResolvedValue(undefined);
});

describe('La demande est deja satisfaite', () => {
  test('acceptee → acceptee ne leve plus rien', async () => {
    const commande = commandeEn('acceptee');
    mockFindByPk.mockResolvedValue(commande);

    const rendu = await CommandeService.changerStatut('cmd-1', VENDEUR, 'acceptee');

    expect(rendu.statut).toBe('acceptee');
    // Rien a ecrire : la commande est deja dans l'etat voulu.
    expect(mockSave).not.toHaveBeenCalled();
  });

  test('le meme bouton presse deux fois donne deux fois le meme resultat', async () => {
    // Premier appui : la transition se fait.
    const commande = commandeEn('en_attente');
    mockFindByPk.mockResolvedValue(commande);
    await CommandeService.changerStatut('cmd-1', VENDEUR, 'en_preparation').catch(() => {});

    // Deuxieme appui, sur une commande deja passee en preparation.
    mockFindByPk.mockResolvedValue(commandeEn('en_preparation'));
    const rendu = await CommandeService.changerStatut('cmd-1', VENDEUR, 'en_preparation');
    expect(rendu.statut).toBe('en_preparation');
  });
});

describe('Le cas courant en boutique', () => {
  test('acceptee + reglement a la reception → en_preparation passe', async () => {
    // Retrait sur place, paiement a la reception : le vendeur prepare tout de
    // suite. C'est le chemin le plus frequent, et c'est celui qui etait casse
    // cote mobile (le bouton n'envoyait rien du tout).
    const commande = commandeEn('acceptee');
    mockFindByPk.mockResolvedValue(commande);

    const rendu = await CommandeService.changerStatut('cmd-1', VENDEUR, 'en_preparation');

    expect(rendu.statut).toBe('en_preparation');
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  test('la suite du parcours reste ouverte', async () => {
    for (const [de, vers] of [
      ['en_preparation', 'prete'],
      ['prete', 'en_livraison'],
      ['en_livraison', 'livree'],
      ['prete', 'livree'], // retrait en boutique : pas d'etape de livraison
    ]) {
      mockFindByPk.mockResolvedValue(commandeEn(de));
      const rendu = await CommandeService.changerStatut('cmd-1', VENDEUR, vers);
      expect(rendu.statut).toBe(vers);
    }
  });
});

describe('Un refus se lit', () => {
  test('le message nomme les deux etats en francais', async () => {
    mockFindByPk.mockResolvedValue(commandeEn('livree'));

    await expect(
      CommandeService.changerStatut('cmd-1', VENDEUR, 'en_preparation')
    ).rejects.toMatchObject({
      status: 400,
      message: 'Cette commande est « Livrée » : elle ne peut pas passer à « En préparation ».',
    });
  });

  test('plus de « Transition impossible » dans le message', async () => {
    mockFindByPk.mockResolvedValue(commandeEn('annulee'));

    const err = await CommandeService.changerStatut('cmd-1', VENDEUR, 'prete').catch((e) => e);
    expect(err.message).not.toMatch(/Transition impossible/);
    expect(err.message).toMatch(/Annulée/);
  });
});

describe('Les gardes existantes tiennent', () => {
  test('une commande d’un autre vendeur reste inaccessible', async () => {
    mockFindByPk.mockResolvedValue({ ...commandeEn('acceptee'), vendeurId: 'autre' });

    await expect(
      CommandeService.changerStatut('cmd-1', VENDEUR, 'en_preparation')
    ).rejects.toMatchObject({ status: 403 });
  });

  test('une commande introuvable repond 404', async () => {
    mockFindByPk.mockResolvedValue(null);

    await expect(
      CommandeService.changerStatut('cmd-1', VENDEUR, 'en_preparation')
    ).rejects.toMatchObject({ status: 404 });
  });

  test('un reglement en ligne non paye bloque toujours la preparation', async () => {
    // Le stock et la logistique ne s'engagent pas avant le paiement.
    mockFindByPk.mockResolvedValue({
      ...commandeEn('acceptee'),
      modePaiement: 'en_ligne',
    });

    await expect(
      CommandeService.changerStatut('cmd-1', VENDEUR, 'en_preparation')
    ).rejects.toMatchObject({ message: expect.stringMatching(/pas encore pay/) });
  });
});
