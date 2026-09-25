-- =====================================================================
--  Migration SaamBiz — validation des profils vendeurs + personnalisation
--  de l'accueil acheteur.
--  À exécuter UNE FOIS sur une base PostgreSQL EXISTANTE (données conservées).
--  Idempotent : peut être relancé sans risque.
--
--  Usage :
--    psql "$DATABASE_URL" -f migrations/20260901_validation_vendeur_et_preferences.sql
--
--  NB : le sync Sequelize n'ajoute PAS de colonne à une table existante.
--  Cette migration est donc obligatoire avant de déployer le code associé.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- UTILISATEUR : validation du profil vendeur par un administrateur
--
-- ATTENTION : la colonne `verifie` existante signifie « adresse email
-- confirmée » (code à 6 chiffres à l'inscription). Elle ne dit rien du
-- sérieux du vendeur. On introduit donc un état distinct, contrôlé par
-- l'administration, qui conditionne la visibilité de la boutique.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_utilisateur_statut_validation') THEN
    CREATE TYPE enum_utilisateur_statut_validation AS ENUM
      ('non_soumis', 'en_attente', 'approuve', 'rejete');
  END IF;
END$$;

ALTER TABLE utilisateur
  ADD COLUMN IF NOT EXISTS statut_validation enum_utilisateur_statut_validation
  NOT NULL DEFAULT 'non_soumis';

-- Pièce justificative transmise par le vendeur (CNI, passeport, registre
-- de commerce…). Stockée comme les autres médias : une URL.
ALTER TABLE utilisateur ADD COLUMN IF NOT EXISTS piece_identite   TEXT;
ALTER TABLE utilisateur ADD COLUMN IF NOT EXISTS type_piece       VARCHAR(50);
ALTER TABLE utilisateur ADD COLUMN IF NOT EXISTS motif_rejet      TEXT;
ALTER TABLE utilisateur ADD COLUMN IF NOT EXISTS date_soumission  TIMESTAMPTZ;
ALTER TABLE utilisateur ADD COLUMN IF NOT EXISTS date_validation  TIMESTAMPTZ;
ALTER TABLE utilisateur ADD COLUMN IF NOT EXISTS valide_par       UUID;

CREATE INDEX IF NOT EXISTS idx_utilisateur_statut_validation
  ON utilisateur (statut_validation);

-- Les vendeurs déjà marqués `verifie` par un administrateur avant cette
-- migration sont considérés comme approuvés : on ne leur coupe pas la
-- visibilité du jour au lendemain.
UPDATE utilisateur
   SET statut_validation = 'approuve',
       date_validation   = COALESCE(date_validation, NOW())
 WHERE role = 'Vendeur'
   AND verifie = true
   AND statut_validation = 'non_soumis';

-- ---------------------------------------------------------------------
-- PREFERENCE_CLIENT : ce qui personnalise l'accueil
--
-- Une ligne par client. Les invités ne sont pas stockés ici : leurs
-- centres d'intérêt voyagent dans la requête, et l'application les garde
-- en local jusqu'à la création d'un compte.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS preference_client (
  utilisateur_id      UUID PRIMARY KEY
                      REFERENCES utilisateur(id) ON DELETE CASCADE,
  -- Catégories choisies à l'inscription, ajustées ensuite par l'usage.
  interets            JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- Dernière position connue, si le client a accepté la géolocalisation.
  latitude            NUMERIC(10, 8),
  longitude           NUMERIC(11, 8),
  ville               VARCHAR(255),
  position_maj_le     TIMESTAMPTZ,
  -- Les 20 dernières recherches : [{ "terme": "...", "date": "..." }]
  recherches_recentes JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- Score par catégorie, alimenté par les vues, recherches et achats.
  -- C'est ce qui fait bouger l'accueil au fil de l'usage.
  affinites           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_preference_client_position
  ON preference_client (latitude, longitude);

COMMIT;
