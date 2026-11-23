/**
 * Choisir une valeur dans une table de correspondance, à partir d'une clé
 * fournie par le client.
 *
 * ── POURQUOI CE FICHIER EXISTE ────────────────────────────────────────────
 *
 * Le motif `TABLE[cleDuClient] || defaut` ressemble à une liste blanche. Il
 * n'en est pas une : la recherche dans un objet JavaScript traverse la CHAÎNE
 * DES PROTOTYPES. Pour une poignée de clés, elle rend donc une valeur qui
 * n'est pas dans la table — et qui est VRAIE, de sorte que le repli `||` ne
 * joue pas.
 *
 *   const TRIS = { recents: [['createdAt', 'DESC']] };
 *   TRIS['nimporte_quoi']  → undefined          → le repli joue  ✅
 *   TRIS['constructor']    → fonction Object     → VRAI, pas de repli  ❌
 *   TRIS['__proto__']      → Object.prototype    → VRAI, pas de repli  ❌
 *   TRIS['toString']       → fonction            → VRAI, pas de repli  ❌
 *
 * Conséquence constatée sur `/catalogue/produits?tri=constructor`, une route
 * publique : c'est la fonction `Object` qui partait comme clause `order` vers
 * Sequelize. Aucune injection SQL — la valeur n'est pas concaténée — mais une
 * erreur 500 déclenchable sans compte.
 *
 * `Object.hasOwn` ne regarde que les clés PROPRES de la table : la liste
 * blanche redevient une liste blanche.
 *
 * Mis dans un utilitaire partagé plutôt que corrigé sur place, parce que le
 * motif se répète (tris du catalogue, tris de la vitrine, alias de catégories)
 * et qu'il se répétera : il est naturel à écrire et le défaut est invisible à
 * la lecture. Un endroit à connaître vaut mieux que trois corrections isolées
 * qu'un quatrième développeur ignorera.
 *
 * @template T
 * @param {Record<string, T>} table - les valeurs autorisées.
 * @param {unknown} cle - la clé reçue du client, de n'importe quel type.
 * @param {T} defaut - la valeur rendue quand la clé n'est pas autorisée.
 * @returns {T}
 */
function choisirDansTable(table, cle, defaut) {
  if (typeof cle !== 'string' && typeof cle !== 'number') return defaut;
  return Object.hasOwn(table, cle) ? table[cle] : defaut;
}

module.exports = choisirDansTable;
