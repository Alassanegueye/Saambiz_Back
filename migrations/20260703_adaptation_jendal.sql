-- =====================================================================
--  Migration Jëndal — adaptation du schéma marketplace
--  À exécuter UNE FOIS sur une base PostgreSQL EXISTANTE (données conservées).
--  Idempotent : peut être relancé sans risque.
--
--  Usage :
--    psql "$DATABASE_URL" -f migrations/20260703_adaptation_jendal.sql
--  ou via Docker :
--    docker exec -i <postgres_container> psql -U $DB_USER -d $DB_NAME \
--      < migrations/20260703_adaptation_jendal.sql
--
--  NB : sur une base VIERGE, `npm run seed` + le sync Sequelize créent déjà
--  ces colonnes — cette migration ne sert que pour une base pré-existante.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- BOUTIQUE : personnalisation + horaires/localisation optionnels
-- ---------------------------------------------------------------------
ALTER TABLE boutique ADD COLUMN IF NOT EXISTS slug          VARCHAR(255);
ALTER TABLE boutique ADD COLUMN IF NOT EXISTS slogan        VARCHAR(255);
ALTER TABLE boutique ADD COLUMN IF NOT EXISTS banniere      TEXT;
ALTER TABLE boutique ADD COLUMN IF NOT EXISTS couleur_theme VARCHAR(9);
ALTER TABLE boutique ADD COLUMN IF NOT EXISTS categorie     VARCHAR(255);

-- Contrainte d'unicité sur le slug (ignorée si déjà présente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'boutique_slug_unique'
  ) THEN
    ALTER TABLE boutique ADD CONSTRAINT boutique_slug_unique UNIQUE (slug);
  END IF;
END $$;

-- Type ENUM du statut de boutique
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_boutique_statut') THEN
    CREATE TYPE enum_boutique_statut AS ENUM ('actif', 'inactif', 'suspendu');
  END IF;
END $$;

ALTER TABLE boutique ADD COLUMN IF NOT EXISTS statut enum_boutique_statut NOT NULL DEFAULT 'actif';

-- Champs autrefois obligatoires (logique restaurant) → optionnels
ALTER TABLE boutique ALTER COLUMN description  DROP NOT NULL;
ALTER TABLE boutique ALTER COLUMN description  TYPE TEXT;
ALTER TABLE boutique ALTER COLUMN localisation DROP NOT NULL;

-- Horaires d'ouverture/fermeture : logique restaurant de l'ancien projet → supprimés
ALTER TABLE boutique DROP COLUMN IF EXISTS heure_ouverture;
ALTER TABLE boutique DROP COLUMN IF EXISTS heure_fermeture;

-- ---------------------------------------------------------------------
-- PRODUIT : attributs marketplace, promo, ventes
-- ---------------------------------------------------------------------
ALTER TABLE produit ADD COLUMN IF NOT EXISTS prix_promo    DECIMAL(10, 2);
ALTER TABLE produit ADD COLUMN IF NOT EXISTS marque        VARCHAR(255);
ALTER TABLE produit ADD COLUMN IF NOT EXISTS attributs     JSONB;
ALTER TABLE produit ADD COLUMN IF NOT EXISTS nombre_ventes INTEGER NOT NULL DEFAULT 0;

-- Champ spécifique à l'ancien projet (nourriture) — supprimé
ALTER TABLE produit DROP COLUMN IF EXISTS delai_preparation;

-- Notes au niveau du PRODUIT : supprimées, et elles le restent. Le modèle
-- `produit` ne déclare plus ni note_moyenne ni nombre_avis.
ALTER TABLE produit DROP COLUMN IF EXISTS note_moyenne;
ALTER TABLE produit DROP COLUMN IF EXISTS nombre_avis;

-- Les avis au niveau de la BOUTIQUE, en revanche, sont revenus avec les
-- vitrines : `VitrineService.accueil()` lit la table `avis` pour la note et
-- les témoignages affichés sur le site public de chaque boutique.
--
-- Un `DROP TABLE IF EXISTS avis CASCADE;` traînait ici. Sur une base NEUVE il
-- cassait le premier démarrage : le bootstrap lance `sequelize.sync()` avant
-- les migrations, donc sync créait la table `avis` (le modèle est enregistré
-- dans models/index.js), cette ligne la supprimait aussitôt, et toutes les
-- vitrines répondaient 500 sur « relation "avis" does not exist ». Le défaut
-- se réparait au redémarrage suivant — sync recréait la table et la migration,
-- déjà consignée dans `migration_appliquee`, ne rejouait pas — ce qui le
-- rendait d'autant plus difficile à attribuer.

-- ---------------------------------------------------------------------
-- FAVORI : cloche de notifications (suivi de boutique)
--  Le modèle Favori n'est pas `underscored` → colonne en camelCase.
-- ---------------------------------------------------------------------
ALTER TABLE favori ADD COLUMN IF NOT EXISTS "clocheActive" BOOLEAN NOT NULL DEFAULT true;

COMMIT;
