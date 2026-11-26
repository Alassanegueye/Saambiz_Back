-- Accès explicite à l'espace Kodafrik (Vue d'ensemble) pour les administrateurs.
BEGIN;

ALTER TABLE utilisateur
  ADD COLUMN IF NOT EXISTS acces_kodafrik BOOLEAN NOT NULL DEFAULT false;

-- Les administrateurs déjà en place conservent leur accès à Kodafrik.
UPDATE utilisateur
  SET acces_kodafrik = true
  WHERE role::text IN ('Admin', 'SuperAdmin')
    AND deleted_at IS NULL
    AND acces_kodafrik = false;

COMMIT;
