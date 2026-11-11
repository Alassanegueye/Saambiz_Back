-- Messages laissés sur la page « Contact » du site d'une boutique : le
-- visiteur n'a pas de compte, il laisse son nom et son numéro ; le vendeur
-- les lit dans « Messages » (application et dashboard).
--
-- sequelize.sync() peut créer la table avant cette migration, d'après le
-- modèle : d'où le CREATE IF NOT EXISTS, puis les valeurs par défaut posées
-- à part, qui valent dans les deux cas.
CREATE TABLE IF NOT EXISTS message_site (
  id UUID PRIMARY KEY,
  vendeur_id UUID NOT NULL REFERENCES utilisateur(id) ON UPDATE CASCADE ON DELETE CASCADE,
  nom VARCHAR(120),
  telephone VARCHAR(30) NOT NULL,
  contenu TEXT NOT NULL,
  lu BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE message_site ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE message_site ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE message_site ALTER COLUMN lu SET DEFAULT false;

CREATE INDEX IF NOT EXISTS message_site_vendeur_id_created_at ON message_site (vendeur_id, created_at);
