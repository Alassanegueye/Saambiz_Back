/**
 * LA BOUTIQUE DANS LA SESSION D'UN VENDEUR.
 *
 * L'écran de choix de compte de l'application affiche la boutique sous le nom
 * du vendeur — deux vendeurs peuvent porter le même nom, et on ne les
 * distinguait qu'en lisant deux adresses email presque identiques.
 *
 * Son lecteur existait depuis longtemps, et son commentaire disait
 * « le serveur la joint à la session d'un vendeur ». Elle ne l'était pas :
 * `login` ne chargeait pas la boutique, et `formatUser` n'envoyait que la
 * liste `boutiques`, que l'application ne lit pas. La ligne restait donc sans
 * boutique, sur tous les téléphones.
 */

const formatUser = require('../../src/utils/formatUser');

const vendeur = (extra = {}) => ({
  id: 'u1',
  nom: 'GUEYE',
  prenom: 'Alassane',
  email: 'alassane@exemple.sn',
  role: 'Vendeur',
  ...extra,
});

describe('formatUser — la boutique d’un vendeur', () => {
  it('joint la boutique au singulier, forme que l’application lit', () => {
    const sortie = formatUser(vendeur({
      boutiques: [{ id: 'b1', nom: 'Aloushop', slug: 'aloushop', logo: 'https://x/l.png' }],
    }));

    expect(sortie.boutique).toEqual({
      id: 'b1',
      nom: 'Aloushop',
      slug: 'aloushop',
      logo: 'https://x/l.png',
    });
  });

  it('garde aussi la liste : une application installée la lit peut-être', () => {
    const sortie = formatUser(vendeur({ boutiques: [{ id: 'b1', nom: 'Aloushop' }] }));
    expect(sortie.boutiques).toHaveLength(1);
  });

  it('accepte une instance Sequelize, dont le nom vit dans dataValues', () => {
    const sortie = formatUser(vendeur({
      boutiques: [{ dataValues: { nom: 'Sañse Couture' } }],
    }));
    expect(sortie.boutique.nom).toBe('Sañse Couture');
  });

  it('n’invente rien quand le vendeur n’a pas encore de boutique', () => {
    expect(formatUser(vendeur({ boutiques: [] })).boutique).toBeUndefined();
    expect(formatUser(vendeur()).boutique).toBeUndefined();
  });

  it('ne joint pas de boutique à un acheteur', () => {
    const sortie = formatUser({
      id: 'u2', nom: 'BEYE', prenom: 'Balla', email: 'balla@exemple.sn', role: 'Acheteur',
      boutiques: [{ nom: 'Pas la sienne' }],
    });
    expect(sortie.boutique).toBeUndefined();
    expect(sortie.boutiques).toBeUndefined();
  });
});
