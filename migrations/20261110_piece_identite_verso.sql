-- =====================================================================
--  Migration SaamBiz — certification des vendeurs : verso de la pièce
--  d'identité.
--
--  Pour être certifié, le vendeur transmet désormais le recto ET le verso
--  de sa pièce. Le recto reste dans `piece_identite` ; le verso arrive ici.
--  Idempotent : peut être relancé sans risque.
-- =====================================================================

ALTER TABLE utilisateur ADD COLUMN IF NOT EXISTS piece_identite_verso TEXT;
