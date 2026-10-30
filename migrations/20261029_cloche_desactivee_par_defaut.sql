-- Suivre une boutique n'active plus la cloche : le client l'active lui-même
-- pour recevoir les notifications (nouveaux produits, promotions, messages).
-- Le nom de la colonne dépend de la façon dont la table a été créée.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'favori' AND column_name = 'clocheActive') THEN
    ALTER TABLE favori ALTER COLUMN "clocheActive" SET DEFAULT false;
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'favori' AND column_name = 'cloche_active') THEN
    ALTER TABLE favori ALTER COLUMN cloche_active SET DEFAULT false;
  END IF;
END $$;
