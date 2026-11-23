"""Produit le test de contrat des routes d'administration du backend.

Le pendant de `generer_contrat.py`, qui exclut `/admin` de son périmètre :
les 84 routes du back-office n'étaient couvertes par aucun test de contrat.

Deux questions, les mêmes que pour les routes mobiles :

 1. la route est-elle montée ? Un chemin mal orthographié se découvre sinon
    depuis l'administration, sous la forme d'un écran vide.
 2. refuse-t-elle une requête sans jeton ? Une route d'administration ne doit
    jamais être protégée par le seul fait qu'aucun menu n'y conduit.

Toutes les routes `/admin` passent par `router.use(auth)` : il n'y a donc pas
de route publique à distinguer ici, contrairement au contrat mobile.
"""

import os
import re

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(RACINE, "tests/integration/.routes-inventaire.txt")
SORTIE = os.path.join(RACINE, "tests/integration/contratRoutesAdmin.http.test.js")

# Un UUID bien formé : les routes qui valident l'identifiant avant d'interroger
# la base ne doivent pas refuser la requête pour une raison étrangère au test.
UUID = "3f6c1c2e-0000-4000-8000-000000000000"

# Segments qui ne sont pas des identifiants.
SEGMENTS = {
    ":cle": "prix_abonnement",
}


def concret(chemin):
    for segment, valeur in SEGMENTS.items():
        chemin = chemin.replace(segment, valeur)
    return re.sub(r":[A-Za-z]+", UUID, chemin)


routes = []
with open(SOURCE, encoding="utf-8") as f:
    for ligne in f:
        ligne = ligne.strip()
        if not ligne:
            continue
        methode, chemin = ligne.split(None, 1)
        if chemin.startswith("/admin"):
            routes.append((methode, chemin))

routes.sort(key=lambda r: (r[1], r[0]))

lignes = [
    "  { methode: '%s', chemin: '%s', url: '%s' }," % (m, c, concret(c))
    for m, c in routes
]

contenu = '''/**
 * Contrat des routes d'administration.
 *
 * Ce fichier est ENGENDRÉ par `scripts/generer_contrat_admin.py` depuis
 * l'inventaire des routes Express. À régénérer avec
 * `bash scripts/regenerer-contrat-routes.sh` après tout ajout de route.
 *
 * Il vérifie deux choses, pour les %d routes du back-office :
 *
 *  1. la route est montée — un chemin mal orthographié dans `app.js` ou un
 *     routeur monté après celui qui le capte produit un 404 que seule
 *     l'administration découvre, en production ;
 *  2. elle refuse une requête sans jeton. Une route d'administration ne doit
 *     jamais tenir sa sécurité du seul fait qu'aucun menu n'y conduit : la
 *     chaîne est `auth` → `checkActiveUser` → `isAdmin` → `requirePermission`,
 *     et c'est le premier maillon qui est vérifié ici.
 *
 * Ce test ne touche pas la base : `auth` refuse avant d'y arriver.
 *
 * Les deux adresses sont couvertes : `/saambiz/v1` et l'alias historique
 * `/saambiz`.
 */

const request = require('supertest');
const app = require('../../src/app');

const ROUTES = [
%s
];

/** Envoie la requête sans jeton. */
function appeler(base, route) {
  return request(app)[route.methode.toLowerCase()](`${base}${route.url}`);
}

describe('Contrat des routes d\\'administration', () => {
  it('l\\'inventaire couvre bien toutes les routes attendues', () => {
    expect(ROUTES).toHaveLength(%d);
  });

  describe.each(['/saambiz/v1', '/saambiz'])('adresse %%s', (base) => {
    it.each(ROUTES.map((r) => [`${r.methode} ${r.chemin}`, r]))(
      '%%s est montée',
      async (_nom, route) => {
        const res = await appeler(base, route);
        expect(res.status).not.toBe(404);
      },
    );
  });

  describe('aucune route d\\'administration n\\'est ouverte', () => {
    it.each(ROUTES.map((r) => [`${r.methode} ${r.chemin}`, r]))(
      '%%s refuse une requête sans jeton',
      async (_nom, route) => {
        const res = await appeler('/saambiz/v1', route);
        expect(res.status).toBe(401);
      },
    );
  });
});
''' % (len(routes), "\n".join(lignes), len(routes))

with open(SORTIE, "w", encoding="utf-8") as f:
    f.write(contenu)

print(f"{len(routes)} routes d'administration écrites")
