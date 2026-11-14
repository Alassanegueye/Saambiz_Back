-- Ce qu'une notification concerne (conversation, commande, boutique), pour
-- que la toucher dans l'application ouvre le bon écran.
--
-- sequelize.sync() peut ajouter la colonne avant cette migration, d'après le
-- modèle : d'où le IF NOT EXISTS, puis la valeur par défaut posée à part.
ALTER TABLE notification ADD COLUMN IF NOT EXISTS donnees JSONB;
UPDATE notification SET donnees = '{}'::jsonb WHERE donnees IS NULL;
ALTER TABLE notification ALTER COLUMN donnees SET DEFAULT '{}'::jsonb;
ALTER TABLE notification ALTER COLUMN donnees SET NOT NULL;
