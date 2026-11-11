-- Numéros de téléphone au format international (« +221771234567 »).
--
-- L'application et le serveur enregistrent désormais les numéros avec leur
-- indicatif, pour pouvoir proposer d'autres pays que le Sénégal. Les anciens
-- numéros à 9 chiffres, sénégalais, reçoivent l'indicatif +221. Un numéro
-- déjà présent sous sa forme internationale n'est pas dupliqué (colonnes
-- uniques) : l'ancienne forme reste alors telle quelle, et la connexion la
-- retrouve quand même. De même pour deux anciennes écritures d'un même numéro
-- (« 771234567 » et « 77 123 45 67 ») : les convertir toutes deux violerait
-- l'unicité et ferait échouer la migration, donc le démarrage du serveur.
DO $$
DECLARE
  cible record;
BEGIN
  FOR cible IN
    SELECT table_name AS t, column_name AS c
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND (table_name, column_name) IN (
         ('utilisateur', 'telephone'),
         ('boutique', 'telephone'),
         ('boutique', 'whatsapp'),
         ('commande', 'clientTelephone'),
         ('commande', 'client_telephone'),
         ('commande', 'numeroTelephone'),
         ('commande', 'numero_telephone')
       )
  LOOP
    EXECUTE format(
      'UPDATE %1$I AS x SET %2$I = ''+221'' || regexp_replace(x.%2$I, ''\D'', '''', ''g'')
        WHERE regexp_replace(x.%2$I, ''\D'', '''', ''g'') ~ ''^[0-9]{9}$''
          AND x.%2$I !~ ''^\+''
          AND (%3$L = ''commande'' OR (NOT EXISTS (
            SELECT 1 FROM %1$I AS y
             WHERE y.%2$I = ''+221'' || regexp_replace(x.%2$I, ''\D'', '''', ''g'')
          ) AND NOT EXISTS (
            SELECT 1 FROM %1$I AS z
             WHERE z.ctid <> x.ctid
               AND z.%2$I !~ ''^\+''
               AND regexp_replace(z.%2$I, ''\D'', '''', ''g'') = regexp_replace(x.%2$I, ''\D'', '''', ''g'')
          )))',
      cible.t, cible.c, cible.t);
  END LOOP;
END $$;
