-- Visites d'une boutique : une ligne par visiteur, par boutique et par jour.
--
-- Le compteur `boutique.vitrine_vues` prenait chaque chargement de la page
-- d'accueil du site : un rafraîchissement, le vendeur qui regarde son propre
-- site, un robot, tout comptait. Les visites faites dans l'application, elles,
-- ne comptaient pas du tout. Cette table rend la visite unique dans la
-- journée ; le compteur n'avance plus que pour une visite nouvelle.
--
-- `visiteur` est une empreinte (SHA-256) : ni adresse IP ni identifiant n'est
-- conservé en clair.
--
-- sequelize.sync() peut créer la table avant cette migration, d'après le
-- modèle : d'où les IF NOT EXISTS, et le même nom d'index des deux côtés.
CREATE TABLE IF NOT EXISTS visite_boutique (
  id BIGSERIAL PRIMARY KEY,
  boutique_id UUID NOT NULL REFERENCES boutique(id) ON UPDATE CASCADE ON DELETE CASCADE,
  jour DATE NOT NULL,
  visiteur CHAR(64) NOT NULL,
  canal VARCHAR(10) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE visite_boutique ALTER COLUMN created_at SET DEFAULT now();

-- L'unicité qui fait la visite « une fois par jour » : l'insertion d'une
-- visite déjà comptée ne fait rien (ON CONFLICT DO NOTHING).
CREATE UNIQUE INDEX IF NOT EXISTS visite_boutique_unique
  ON visite_boutique (boutique_id, jour, visiteur);
