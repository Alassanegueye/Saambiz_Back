"""Produit le test de contrat des routes mobiles du backend.

Le tableau est engendré depuis l'inventaire réel des routes Express, pas
recopié à la main : une route ajoutée demain au backend apparaît dans
l'inventaire, et son absence du test se voit.
"""

import os
import re
import sys

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(RACINE, "tests/integration/.routes-inventaire.txt")
SORTIE = os.path.join(RACINE, "tests/integration/contratRoutesMobile.http.test.js")

# Hors périmètre mobile.
EXCLUS = (
    re.compile(r"^/admin"),
    re.compile(r"^/vitrine"),
    re.compile(r"webhook"),
)

# Routeurs entiers derrière `router.use(auth)`.
PREFIXES_PROTEGES = (
    "/account",
    "/acheteurs",
    "/commandes",
    "/device-token",
    "/favoris",
    "/messages",
    "/notifications",
    "/paiement",
    "/vendeur",
)

# Routes protégées une par une.
PROTEGEES_UNITAIRES = {
    ("POST", "/auth/logout"),
    ("POST", "/auth/changer-mot-de-passe"),
    ("POST", "/avis"),
    ("GET", "/avis/boutique/:boutiqueId/mon-avis"),
    ("DELETE", "/avis/boutique/:boutiqueId"),
    ("GET", "/promotions"),
    ("POST", "/promotions"),
    ("POST", "/promotions/campagne"),
    ("PUT", "/promotions/:id"),
    ("DELETE", "/promotions/:id"),
    ("POST", "/signalements"),
    ("GET", "/signalements/mes-signalements"),
}

# Routes ouvertes aux visiteurs sans compte malgré leur préfixe, pour deux
# raisons distinctes : soit elles passent par `authOptionnel`, qui enrichit la
# réponse si un jeton est présent mais n'en exige pas ; soit elles sont
# déclarées AVANT le `router.use(auth)` de leur fichier, que cet inventaire
# par préfixe ne sait pas voir.
PUBLIQUES_UNITAIRES = {
    ("GET", "/acheteurs/accueil-personnalise"),
    ("GET", "/acheteurs/accueil-section/:cle"),
    # Mot de passe oublié : demandé précisément par qui ne peut pas
    # s'authentifier.
    ("POST", "/account/forgot-password"),
    ("POST", "/account/reset-password"),
}

# Valeur donnée aux segments dynamiques : un UUID bien formé, pour que les
# routes qui valident l'identifiant avant d'interroger la base ne refusent pas
# la requête pour une raison étrangère au test.
UUID = "3f6c1c2e-0000-4000-8000-000000000000"

# Quelques segments ne sont pas des identifiants : leur donner un UUID ferait
# répondre 404 au contrôleur, ce qui ressemblerait à une route absente.
SEGMENTS = {
    ":cle": "nouveautes",
}


def protegee(methode, chemin):
    if (methode, chemin) in PUBLIQUES_UNITAIRES:
        return False
    if (methode, chemin) in PROTEGEES_UNITAIRES:
        return True
    return any(chemin.startswith(p) for p in PREFIXES_PROTEGES)


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
        if any(m.search(chemin) for m in EXCLUS):
            continue
        routes.append((methode, chemin))

routes.sort(key=lambda r: (r[1], r[0]))

lignes = []
for methode, chemin in routes:
    lignes.append(
        "  { methode: '%s', chemin: '%s', url: '%s', protegee: %s },"
        % (methode, chemin, concret(chemin), "true" if protegee(methode, chemin) else "false")
    )

nb_protegees = sum(1 for m, c in routes if protegee(m, c))

contenu = '''/**
 * Contrat des routes destinées à l'application mobile.
 *
 * Ce fichier est ENGENDRÉ depuis l'inventaire des routes Express
 * (`scripts/generer_contrat.py`). Il répond à deux questions que
 * rien d'autre ne pose :
 *
 *  1. la route est-elle réellement montée ? Un chemin mal orthographié dans
 *     `app.js`, un routeur oublié, un `router.use` placé après une route qui
 *     le capte : tout cela produit un 404 que seule l'application découvre,
 *     en production, sous la forme d'un écran vide.
 *
 *  2. la route est-elle protégée quand elle doit l'être ? Un `authMiddleware`
 *     oublié ouvre une route de vendeur au premier venu. Le test interroge
 *     SANS jeton : une route protégée doit répondre 401, pas 200 ni 500.
 *
 * Les routes publiques ne sont vérifiées que sur le premier point : sans base
 * de données, leur contrôleur échoue — ce qui est sans importance ici, un 500
 * prouvant déjà que la route existe et qu'elle a été atteinte.
 *
 * Les deux adresses sont couvertes : `/saambiz/v1` (référence) et `/saambiz`
 * (alias historique, encore appelé par les applications installées).
 *
 * %d routes, dont %d protégées.
 */

const request = require('supertest');
const app = require('../../src/app');

const ROUTES = [
%s
];

/** Envoie la requête sans jeton. */
function appeler(base, route) {
  const agent = request(app);
  const verbe = route.methode.toLowerCase();
  return agent[verbe](`${base}${route.url}`);
}

describe('Contrat des routes mobiles', () => {
  it('l\\'inventaire couvre bien toutes les routes attendues', () => {
    expect(ROUTES).toHaveLength(%d);
    expect(ROUTES.filter((r) => r.protegee)).toHaveLength(%d);
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

  describe('protection par jeton', () => {
    const protegees = ROUTES.filter((r) => r.protegee);

    it.each(protegees.map((r) => [`${r.methode} ${r.chemin}`, r]))(
      '%%s refuse une requête sans jeton',
      async (_nom, route) => {
        const res = await appeler('/saambiz/v1', route);
        expect(res.status).toBe(401);
      },
    );
  });

  describe('routes publiques', () => {
    const publiques = ROUTES.filter((r) => !r.protegee);

    it.each(publiques.map((r) => [`${r.methode} ${r.chemin}`, r]))(
      '%%s reste accessible sans jeton',
      async (_nom, route) => {
        const res = await appeler('/saambiz/v1', route);
        // Ni 401 ni 403 : ces routes s'adressent à des visiteurs sans compte.
        expect([401, 403]).not.toContain(res.status);
      },
    );
  });
});
''' % (len(routes), nb_protegees, "\n".join(lignes), len(routes), nb_protegees)

with open(SORTIE, "w", encoding="utf-8") as f:
    f.write(contenu)

print(f"{len(routes)} routes écrites, dont {nb_protegees} protégées")
print(SORTIE)
