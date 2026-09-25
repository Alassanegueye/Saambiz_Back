-- =====================================================================
--  Migration SaamBiz — stockage des jetons de rafraîchissement
--
--  Avant cette table, un refresh signé pour sept jours restait valable
--  sept jours quoi qu'il arrive : pas de révocation à la déconnexion, pas
--  de plafond de sessions, aucun moyen de couper l'accès d'un appareil
--  perdu. Le jeton n'est jamais stocké en clair, seulement son SHA-256.
--
--  Idempotent : peut être relancé sans risque.
--    psql "$DATABASE_URL" -f migrations/20260903_refresh_token.sql
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS refresh_token (
  id             UUID PRIMARY KEY,
  utilisateur_id UUID        NOT NULL
                 REFERENCES utilisateur(id) ON DELETE CASCADE,
  -- SHA-256 hexadécimal : 64 caractères. Suffisant ici, contrairement aux
  -- mots de passe — un refresh est déjà une valeur aléatoire de haute
  -- entropie, il n'y a rien à deviner par force brute.
  token_hash     VARCHAR(64) NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  -- On garde la ligne après révocation au lieu de la supprimer : savoir
  -- qu'une session a été coupée, et quand, sert aux enquêtes.
  revoked_at     TIMESTAMPTZ,
  user_agent     VARCHAR(255),
  adresse_ip     VARCHAR(64),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lu à chaque rafraîchissement.
CREATE INDEX IF NOT EXISTS idx_refresh_token_hash
  ON refresh_token (token_hash);

-- Plafond de sessions par compte et révocation en masse.
CREATE INDEX IF NOT EXISTS idx_refresh_token_utilisateur
  ON refresh_token (utilisateur_id);

-- Purge horaire par le cron.
CREATE INDEX IF NOT EXISTS idx_refresh_token_expiration
  ON refresh_token (expires_at);

COMMIT;
