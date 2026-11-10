-- Un client ne reçoit les notifications d'une boutique que s'il a activé
-- lui-même la cloche.
--
-- Avant le 29/10/2026, suivre une boutique activait la cloche d'office, et
-- la migration 20261029 n'a changé que la valeur par défaut : ces anciens
-- suivis gardaient la cloche allumée sans que le client l'ait demandé. On
-- l'éteint sur tous les suivis antérieurs jamais retouchés depuis leur
-- création (un client qui a lui-même basculé la cloche a une date de mise à
-- jour postérieure, son choix est conservé).
DO $$
DECLARE
  col_cloche text;
  col_cree text;
  col_maj text;
BEGIN
  SELECT column_name INTO col_cloche FROM information_schema.columns
   WHERE table_name = 'favori' AND column_name IN ('clocheActive', 'cloche_active') LIMIT 1;
  SELECT column_name INTO col_cree FROM information_schema.columns
   WHERE table_name = 'favori' AND column_name IN ('createdAt', 'created_at') LIMIT 1;
  SELECT column_name INTO col_maj FROM information_schema.columns
   WHERE table_name = 'favori' AND column_name IN ('updatedAt', 'updated_at') LIMIT 1;

  IF col_cloche IS NULL THEN
    RETURN;
  END IF;

  IF col_cree IS NULL OR col_maj IS NULL THEN
    -- Sans dates, impossible de distinguer un choix du client : on éteint tout.
    EXECUTE format('UPDATE favori SET %I = false WHERE %I = true', col_cloche, col_cloche);
  ELSE
    EXECUTE format(
      'UPDATE favori SET %I = false
        WHERE %I = true
          AND %I < TIMESTAMP ''2026-10-29''
          AND %I <= %I + INTERVAL ''5 seconds''',
      col_cloche, col_cloche, col_cree, col_maj, col_cree);
  END IF;
END $$;
