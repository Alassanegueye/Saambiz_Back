-- Les photos du haut du site d'une boutique : elles défilent en boucle
-- dans le grand bandeau de l'accueil. [{ id, url }], dans l'ordre choisi
-- par le vendeur (au plus 10).
ALTER TABLE boutique ADD COLUMN IF NOT EXISTS vitrine_photos JSONB;
