-- =====================================================================
--  Migration SaamBiz — l'assistant de création de vitrine
--
--  La vitrine ne se règle plus champ par champ : le vendeur téléverse son
--  logo, dit ce qu'il vend, et le site est composé pour lui. Ce que cette
--  migration ajoute sert à ça :
--
--    - ce que l'analyse du logo a trouvé (forme, palette proposée), pour
--      que le site sache où poser le logo sans le réanalyser à chaque
--      affichage ;
--    - le secteur d'activité déclaré, qui décide de la mise en page
--      proposée et du texte pré-rempli ;
--    - un drapeau « configurée », distinct de « active ».
--
--  Pourquoi deux drapeaux plutôt qu'un : « active » dit si le site est
--  ouvert au public — le vendeur le ferme et le rouvre quand il veut.
--  « configurée » dit s'il est passé par l'assistant, une seule fois. Le
--  tableau de bord web s'appuie sur le second pour afficher « activez
--  votre boutique depuis l'application » : la création se fait dans
--  l'application mobile, pas ailleurs.
--
--  Idempotent : peut être relancé sans risque.
--    psql "$DATABASE_URL" -f migrations/20260911_assistant_vitrine.sql
-- =====================================================================

BEGIN;

-- ── Ce que l'assistant a déduit du logo ──────────────────────────────
-- 'rond' | 'carre' | 'bandeau' | 'libre'. Décide de l'habillage du logo
-- dans l'en-tête du site : pastille, tuile arrondie, pleine largeur, ou
-- posé tel quel. Un logo rond rogné en carré perd ses bords ; un logo
-- avec le nom écrit dedans, enfermé dans une pastille, devient illisible.
ALTER TABLE boutique ADD COLUMN IF NOT EXISTS vitrine_logo_forme VARCHAR(16);

-- Les couleurs relevées dans le logo et les harmonies calculées, telles
-- qu'elles ont été proposées au vendeur. Conservées pour qu'il retrouve
-- ses choix en revenant sur l'écran, sans avoir à re-téléverser son logo.
ALTER TABLE boutique ADD COLUMN IF NOT EXISTS vitrine_palette JSONB;

-- ── Ce que le vendeur a déclaré de son activité ──────────────────────
-- Secteur ('mode', 'alimentation', 'electronique'…) et description libre
-- de ce qu'il vend. Le premier choisit la mise en page et le ton des
-- textes ; la seconde alimente la présentation de la boutique.
ALTER TABLE boutique ADD COLUMN IF NOT EXISTS vitrine_secteur VARCHAR(32);
ALTER TABLE boutique ADD COLUMN IF NOT EXISTS vitrine_activite VARCHAR(300);

-- ── Le site est-il passé par l'assistant ? ───────────────────────────
ALTER TABLE boutique ADD COLUMN IF NOT EXISTS vitrine_configuree BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE boutique ADD COLUMN IF NOT EXISTS vitrine_creee_le TIMESTAMPTZ;

-- ── Plus rien n'est publié sans décision du vendeur ──────────────────
-- La migration précédente ouvrait la vitrine de toutes les boutiques par
-- défaut. Avec l'assistant, ce n'est plus le bon comportement : personne
-- ne doit avoir un site public qu'il n'a pas composé, encore moins un
-- site vide portant son nom. On referme donc les vitrines qui n'ont
-- jamais été configurées, et le défaut de la colonne suit.
UPDATE boutique SET vitrine_active = FALSE WHERE vitrine_configuree = FALSE;
ALTER TABLE boutique ALTER COLUMN vitrine_active SET DEFAULT FALSE;

COMMIT;
