-- Rotation des jetons de rafraîchissement : on note quand un jeton a été
-- remplacé, et par lequel. Un téléphone qui perd la réponse du serveur au
-- milieu d'un renouvellement (réseau coupé, application fermée) représente
-- l'ancien jeton : dans un court délai, on lui en donne un nouveau au lieu de
-- le déconnecter.
ALTER TABLE refresh_token ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ;
ALTER TABLE refresh_token ADD COLUMN IF NOT EXISTS remplace_par UUID;
