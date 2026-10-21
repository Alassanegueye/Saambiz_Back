-- Contenus du site choisis par le vendeur : avantages (« Livraison
-- rapide »…) et icônes des catégories.
ALTER TABLE boutique ADD COLUMN IF NOT EXISTS vitrine_blocs JSONB;
