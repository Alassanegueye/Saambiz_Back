-- Montant disponible sur le compte du vendeur, en FCFA.
--
-- La colonne est posée maintenant pour que l'écran « Compte » du vendeur ait
-- une valeur à afficher. Rien ne l'alimente ni ne la débite encore : les
-- reversements, les retenues de commission et les retraits seront traités
-- plus tard. Un compte neuf part donc de 0, et y reste.
--
-- NUMERIC plutôt que DOUBLE : un solde est de l'argent, et l'arrondi binaire
-- d'un flottant finit par ne plus tomber juste. Douze chiffres au lieu des dix
-- habituels de ce schéma parce qu'un solde s'accumule, là où un prix unitaire
-- ne s'accumule pas.
--
-- NOT NULL DEFAULT 0 : un solde absent n'a pas de sens, et un NULL obligerait
-- chaque lecture à décider s'il vaut zéro — autant que la base tranche.
ALTER TABLE utilisateur
  ADD COLUMN IF NOT EXISTS solde_disponible NUMERIC(12, 2) NOT NULL DEFAULT 0;
