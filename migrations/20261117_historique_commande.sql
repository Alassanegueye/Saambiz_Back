-- Historique d'une commande : qui a fait quoi, quand, et depuis quel état.
--
-- Le journal d'audit existant (audit_log) ne convenait pas : son admin_id est
-- obligatoire et référence un administrateur, alors qu'ici l'auteur est le
-- plus souvent un acheteur ou un vendeur.
--
-- RIEN N'EST MODIFIABLE : pas de colonne updated_at, aucune route d'écriture
-- ni de suppression. Une ligne posée reste, y compris quand la commande est
-- annulée — c'est précisément là qu'on en a besoin.
CREATE TABLE IF NOT EXISTS historique_commande (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commande_id    UUID NOT NULL,
  -- NULL quand l'opération vient du système : encaissement confirmé par la
  -- passerelle de paiement, tâche planifiée.
  auteur_id      UUID,
  auteur_role    VARCHAR(20) NOT NULL DEFAULT 'systeme',
  operation      VARCHAR(40) NOT NULL,
  statut_avant   VARCHAR(30),
  statut_apres   VARCHAR(30),
  paiement_avant VARCHAR(20),
  paiement_apres VARCHAR(20),
  motif          TEXT,
  details        JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pas de clé étrangère vers `commande` : l'historique doit survivre, et une
-- commande ne se supprime plus de toute façon. Un index suffit à la lecture.
CREATE INDEX IF NOT EXISTS historique_commande_commande_id_idx ON historique_commande (commande_id);
CREATE INDEX IF NOT EXISTS historique_commande_auteur_id_idx   ON historique_commande (auteur_id);
CREATE INDEX IF NOT EXISTS historique_commande_operation_idx   ON historique_commande (operation);
