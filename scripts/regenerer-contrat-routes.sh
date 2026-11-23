#!/usr/bin/env bash
# Régénère le test de contrat des routes mobiles depuis les routes réelles.
#
# À relancer après tout ajout ou retrait de route : le test engendré liste les
# chemins un par un, et c'est précisément cette liste figée qui permet de voir
# qu'une route a disparu.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/routes.py $(find src/routes -name '*.js') \
  | sort -k2 > tests/integration/.routes-inventaire.txt
python3 scripts/generer_contrat.py
# Les routes /admin sont hors du périmètre mobile : elles ont leur propre
# contrat, sans quoi les 84 routes du back-office n'étaient couvertes par
# aucun test.
python3 scripts/generer_contrat_admin.py
