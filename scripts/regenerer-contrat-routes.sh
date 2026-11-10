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
