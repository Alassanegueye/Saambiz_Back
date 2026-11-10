"""Inventaire des routes Express du backend SaamBiz.

Imprime `MÉTHODE  chemin-complet` par route, en préfixant le point de montage
déduit du nom du fichier. Une regex sur une seule ligne manquait toutes les
routes déclarées sur plusieurs lignes, qui sont la majorité ici.
"""

import re
import sys
import os

MONTAGE = {
    "auth.route.js": "/auth",
    "account.route.js": "/account",
    "acheteurs.route.js": "/acheteurs",
    "admin.route.js": "/admin",
    "adminManagement.route.js": "/admin/rbac",
    "avis.route.js": "/avis",
    "catalogue.route.js": "/catalogue",
    "categorie.route.js": "/categories",
    "commande.route.js": "/commandes",
    "configPublique.route.js": "",
    "deviceToken.route.js": "/device-token",
    "favori.route.js": "/favoris",
    "message.route.js": "/messages",
    "notification.route.js": "/notifications",
    "paiement.route.js": "/paiement",
    "promotion.route.js": "/promotions",
    "signalement.route.js": "/signalements",
    "vendeur.route.js": "/vendeur",
    "vitrine.route.js": "/vitrine",
}

MOTIF = re.compile(
    r"router\.(get|post|put|patch|delete)\s*\(\s*['\"]([^'\"]*)['\"]", re.S
)

for chemin in sys.argv[1:]:
    base = os.path.basename(chemin)
    prefixe = MONTAGE.get(base, "/?" + base)
    with open(chemin, encoding="utf-8") as f:
        contenu = f.read()
    for methode, route in MOTIF.findall(contenu):
        complet = (prefixe + route).replace("//", "/")
        if complet != "/" and complet.endswith("/"):
            complet = complet[:-1]
        print(f"{methode.upper():7} {complet}")
