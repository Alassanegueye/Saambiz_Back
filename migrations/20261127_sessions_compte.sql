-- Sessions de compte des clients, vendeurs et administrateurs.
--
-- Une SESSION est la vie d'un compte, de sa création à sa suppression. Une
-- PERSONNE peut en avoir plusieurs : elle supprime son compte (la session se
-- ferme, son e-mail et son téléphone sont libérés), puis en recrée un avec la
-- même adresse (une nouvelle session s'ouvre, rattachée à la même personne).
--
--   utilisateur.personne_id : l'identifiant stable de la personne, commun à
--                             tous ses comptes successifs ;
--   utilisateur.id_session  : la session du compte ;
--   session_compte          : l'historique, une ligne par session — c'est là
--                             qu'on retrouve toutes les sessions d'une personne.

ALTER TABLE utilisateur ADD COLUMN IF NOT EXISTS personne_id UUID;
ALTER TABLE utilisateur ADD COLUMN IF NOT EXISTS id_session UUID;

UPDATE utilisateur SET personne_id = id WHERE personne_id IS NULL;
UPDATE utilisateur SET id_session = gen_random_uuid() WHERE id_session IS NULL;

CREATE INDEX IF NOT EXISTS utilisateur_personne_idx ON utilisateur (personne_id);
CREATE UNIQUE INDEX IF NOT EXISTS utilisateur_id_session_uq ON utilisateur (id_session);

CREATE TABLE IF NOT EXISTS session_compte (
  id_session       UUID PRIMARY KEY,
  personne_id      UUID NOT NULL,
  utilisateur_id   UUID REFERENCES utilisateur(id) ON DELETE SET NULL,
  role             VARCHAR(30),
  -- L'adresse et le téléphone D'ORIGINE (ceux du compte peuvent être libérés
  -- à la suppression) : c'est par eux qu'un nouveau compte retrouve sa personne.
  email            VARCHAR(255),
  telephone        VARCHAR(30),
  ouverte_le       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fermee_le        TIMESTAMPTZ,
  motif_fermeture  VARCHAR(500)
);

CREATE INDEX IF NOT EXISTS session_compte_personne_idx ON session_compte (personne_id, ouverte_le DESC);
CREATE INDEX IF NOT EXISTS session_compte_email_idx ON session_compte (lower(email));
CREATE INDEX IF NOT EXISTS session_compte_telephone_idx ON session_compte (telephone);

-- Une session pour chaque compte existant : ouverte, ou fermée s'il a été supprimé.
INSERT INTO session_compte (id_session, personne_id, utilisateur_id, role, email, telephone, ouverte_le, fermee_le, motif_fermeture)
SELECT u.id_session, u.personne_id, u.id, u.role, u.email, u.telephone, u.created_at,
       CASE WHEN u.compte_supprime OR u.deleted_at IS NOT NULL
            THEN COALESCE(u.date_suppression, u.deleted_at, NOW()) END,
       CASE WHEN u.compte_supprime OR u.deleted_at IS NOT NULL
            THEN 'Compte supprimé (avant les sessions de compte)' END
FROM utilisateur u
ON CONFLICT (id_session) DO NOTHING;

-- Les comptes déjà supprimés libèrent leur e-mail et leur téléphone : on peut
-- recréer un compte avec la même adresse.
UPDATE utilisateur
SET email = left('supprime.' || left(id::text, 8) || '.' || email, 255),
    telephone = NULL
WHERE (compte_supprime OR deleted_at IS NOT NULL)
  AND email NOT LIKE 'supprime.%';
