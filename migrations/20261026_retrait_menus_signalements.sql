-- =====================================================================
--  Migration SaamBiz — pages Menus et Signalements retirées du dashboard
--
--  Les rubriques sont désactivées (pas supprimées) : elles disparaissent
--  de la navigation et de la grille des accès, mais les permissions déjà
--  données restent en base et l'opération est réversible.
--  Les signalements envoyés depuis l'application restent enregistrés.
--
--  Idempotent : peut être relancé sans risque.
-- =====================================================================

BEGIN;

UPDATE menus SET "isActive" = false WHERE code IN ('MENUS', 'SIGNALEMENTS');

COMMIT;
