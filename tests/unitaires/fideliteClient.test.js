const { niveauFidelite } = require('../../src/utils/fideliteClient');

describe('niveauFidelite', () => {
  test.each([[0, 'nouveau'], [2, 'nouveau'], [3, 'fidele'], [12, 'fidele']])(
    '%i commande(s) : %s',
    (commandes, niveau) => {
      expect(niveauFidelite(commandes)).toBe(niveau);
    }
  );
});
