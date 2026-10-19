-- =====================================================================
--  Migration SaamBiz — options choisies sur une ligne de commande
--
--  Le client choisit sa taille, son parfum, son format… sur la fiche
--  produit. Ces choix doivent arriver jusqu'au vendeur : sans eux, il
--  reçoit « 2 × Jus » sans savoir lesquels préparer.
--    { "Parfums": "Bissap", "Formats": "1 L" }
--
--  Idempotent : peut être relancé sans risque.
-- =====================================================================

BEGIN;

ALTER TABLE ligne_commande ADD COLUMN IF NOT EXISTS options JSONB;

COMMIT;
