-- Code d'accès à quatre chiffres des administrateurs (portail KODAFRIK).
--
-- Demandé après le mot de passe, avant chaque entrée dans un dashboard. Le
-- code est stocké haché (bcrypt), jamais en clair. Le serveur l'EXIGE : une
-- session dont le code n'a pas été vérifié n'ouvre aucune route /admin
-- (isAdmin.middleware → 403 CODE_ACCES_REQUIS).

CREATE TABLE IF NOT EXISTS code_acces_admin (
  utilisateur_id UUID PRIMARY KEY REFERENCES utilisateur(id) ON DELETE CASCADE,
  code_hash      VARCHAR(100) NOT NULL,
  echecs         INTEGER NOT NULL DEFAULT 0,
  bloque_jusqua  TIMESTAMPTZ,
  modifie_le     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  modifie_par    UUID
);

-- La session (le jeton de rafraîchissement) dont le code a été vérifié. Le
-- drapeau suit la session de rotation en rotation ; il est effacé quand le
-- code change.
ALTER TABLE refresh_token ADD COLUMN IF NOT EXISTS code_acces_verifie_le TIMESTAMPTZ;
