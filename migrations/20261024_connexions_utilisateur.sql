-- =====================================================================
--  Migration SaamBiz — dates de connexion des comptes
--
--  premiere_connexion : renseignée une seule fois, à la toute première
--  connexion réussie (affichée dans la page Administrateurs).
--  derniere_connexion : mise à jour à chaque connexion réussie.
--
--  Idempotent : peut être relancé sans risque.
-- =====================================================================

BEGIN;

ALTER TABLE utilisateur ADD COLUMN IF NOT EXISTS premiere_connexion TIMESTAMP WITH TIME ZONE;
ALTER TABLE utilisateur ADD COLUMN IF NOT EXISTS derniere_connexion TIMESTAMP WITH TIME ZONE;

COMMIT;
