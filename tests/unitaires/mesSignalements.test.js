/**
 * Les signalements d'un utilisateur, avec ce qu'ils visent.
 *
 * La table ne garde qu'un `cibleId` et un `type`. L'application recevait donc
 * une liste sans nom, et affichait la raison saisie a la place de la boutique
 * — « dww » en gros titre, au-dessus d'une description. On ne savait plus de
 * quoi on avait parle.
 */

const mockSignalements = jest.fn();
const mockBoutiques = jest.fn();
const mockProduits = jest.fn();

jest.mock('../../src/models', () => ({
  Signalement: { findAll: (...a) => mockSignalements(...a) },
  Boutique: { findAll: (...a) => mockBoutiques(...a), findByPk: jest.fn() },
  Produit: { findAll: (...a) => mockProduits(...a), findByPk: jest.fn() },
}));

const SignalementService = require('../../src/services/signalements/signalement.service');

/** Une ligne de la table, telle que Sequelize la rend. */
function ligne(modifs = {}) {
  const base = {
    id: 's1',
    type: 'boutique',
    cibleId: 'b1',
    raison: 'Produits contrefaits',
    description: 'Des logos de marque',
    statut: 'en_attente',
    ...modifs,
  };
  return { ...base, toJSON: () => ({ ...base }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockBoutiques.mockResolvedValue([]);
  mockProduits.mockResolvedValue([]);
});

describe('La cible est nommee', () => {
  test('une boutique rend son nom et son logo', async () => {
    mockSignalements.mockResolvedValue([ligne()]);
    mockBoutiques.mockResolvedValue([
      { id: 'b1', nom: 'Maison Ndiaye Couture', logo: 'https://x/l.png' },
    ]);

    const { signalements } = await SignalementService.mesSignalements('u1');

    expect(signalements[0].cible).toEqual({
      id: 'b1',
      nom: 'Maison Ndiaye Couture',
      image: 'https://x/l.png',
    });
  });

  test('un produit rend son nom et son image', async () => {
    mockSignalements.mockResolvedValue([
      ligne({ id: 's2', type: 'produit', cibleId: 'p1' }),
    ]);
    mockProduits.mockResolvedValue([
      { id: 'p1', nom: 'Robe wax', image: 'https://x/p.jpg' },
    ]);

    const { signalements } = await SignalementService.mesSignalements('u1');
    expect(signalements[0].cible.nom).toBe('Robe wax');
    expect(signalements[0].cible.image).toBe('https://x/p.jpg');
  });

  test('une cible disparue rend `null`, et le signalement reste', async () => {
    // Boutique fermee, produit retire : le signalement garde tout son
    // interet, c'est meme la qu'il en a le plus.
    mockSignalements.mockResolvedValue([ligne({ cibleId: 'inconnu' })]);

    const { signalements } = await SignalementService.mesSignalements('u1');
    expect(signalements).toHaveLength(1);
    expect(signalements[0].cible).toBeNull();
    expect(signalements[0].raison).toBe('Produits contrefaits');
  });
});

describe('Le nombre de requetes ne suit pas le nombre de signalements', () => {
  test('dix signalements, deux requetes de cibles', async () => {
    // Une requete par signalement ferait vingt allers-retours pour une page.
    const lignes = [];
    for (let i = 0; i < 5; i++) {
      lignes.push(ligne({ id: `sb${i}`, type: 'boutique', cibleId: `b${i}` }));
      lignes.push(ligne({ id: `sp${i}`, type: 'produit', cibleId: `p${i}` }));
    }
    mockSignalements.mockResolvedValue(lignes);

    await SignalementService.mesSignalements('u1');

    expect(mockBoutiques).toHaveBeenCalledTimes(1);
    expect(mockProduits).toHaveBeenCalledTimes(1);
  });

  test('aucune boutique signalee : aucune requete de boutiques', async () => {
    mockSignalements.mockResolvedValue([ligne({ type: 'produit', cibleId: 'p1' })]);

    await SignalementService.mesSignalements('u1');

    expect(mockBoutiques).not.toHaveBeenCalled();
    expect(mockProduits).toHaveBeenCalledTimes(1);
  });

  test('une meme cible signalee deux fois n’est demandee qu’une', async () => {
    mockSignalements.mockResolvedValue([
      ligne({ id: 's1', cibleId: 'b1' }),
      ligne({ id: 's2', cibleId: 'b1' }),
    ]);

    await SignalementService.mesSignalements('u1');

    const [{ where }] = mockBoutiques.mock.calls[0];
    expect(where.id).toEqual(['b1']);
  });

  test('une liste vide ne declenche aucune requete', async () => {
    mockSignalements.mockResolvedValue([]);

    const { signalements } = await SignalementService.mesSignalements('u1');

    expect(signalements).toEqual([]);
    expect(mockBoutiques).not.toHaveBeenCalled();
    expect(mockProduits).not.toHaveBeenCalled();
  });
});
