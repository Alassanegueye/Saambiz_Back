-- Demande d'annulation d'une commande déjà en préparation.
--
-- L'acheteur ne peut plus annuler seul une commande que le vendeur a
-- commencé à préparer : il la DEMANDE, et le vendeur accepte ou refuse.
-- Deux colonnes suffisent, plutôt qu'un onzième statut : la commande reste
-- « en préparation » tant que le vendeur n'a pas répondu, et toutes les
-- règles de transition existantes continuent de s'appliquer telles quelles.
--
-- `annulation_demandee_le` NULL = aucune demande en cours. C'est cette
-- colonne, et elle seule, qui dit qu'une demande attend une réponse.
ALTER TABLE commande ADD COLUMN IF NOT EXISTS annulation_demandee_le TIMESTAMPTZ;
ALTER TABLE commande ADD COLUMN IF NOT EXISTS annulation_motif TEXT;

-- Le refus du vendeur est conservé : l'acheteur doit pouvoir lire pourquoi
-- sa demande n'a pas été suivie, et le motif ne doit pas disparaître avec la
-- demande elle-même.
ALTER TABLE commande ADD COLUMN IF NOT EXISTS annulation_refus_motif TEXT;
