-- Suppression de compte demandée par l'utilisateur : le compte et ses
-- données restent en base, marqués supprimés. On ne peut plus s'y connecter,
-- et son e-mail comme son numéro ne peuvent pas servir à un nouveau compte.
ALTER TABLE utilisateur ADD COLUMN IF NOT EXISTS compte_supprime BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE utilisateur ADD COLUMN IF NOT EXISTS date_suppression TIMESTAMPTZ NULL;
