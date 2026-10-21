-- =====================================================================
--  Migration SaamBiz — sections personnalisées du site d'une boutique
--
--  Le vendeur crée ses propres sections (« Nouvelle collection », « Promo
--  Tabaski »…), les renomme, et choisit les produits qui y figurent :
--    [{ "id": "…", "titre": "Nouvelle collection", "produitIds": ["…"] }]
--
--  Idempotent : peut être relancé sans risque.
-- =====================================================================

BEGIN;

ALTER TABLE boutique ADD COLUMN IF NOT EXISTS vitrine_sections_perso JSONB;

COMMIT;
