-- =====================================================================
--  Migration SaamBiz — caractéristiques produit par catégorie
--
--  Chaque catégorie propose des caractéristiques que le VENDEUR remplit
--  lui-même : Tailles, Couleurs, Parfums, Formats… Ce sont des cases vides
--  bien nommées ; aucune liste de valeurs n'est imposée, aucun champ n'est
--  obligatoire, et le vendeur peut ajouter ses propres caractéristiques.
--
--  Valeurs initiales seulement : une catégorie déjà modifiée depuis le
--  dashboard n'est pas touchée. Source : src/constants/
--  specificationsCategories.js (ce fichier en est généré).
--
--  Idempotent : peut être relancé sans risque.
-- =====================================================================

BEGIN;

ALTER TABLE categorie ADD COLUMN IF NOT EXISTS specifications JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE categorie SET specifications = '[{"cle":"tailles","libelle":"Tailles","type":"variantes","options":[],"libre":true,"aide":"Ex. S, M, L, XL"},{"cle":"couleurs","libelle":"Couleurs","type":"variantes","options":[],"libre":true,"aide":"Ex. Noir, Blanc, Rouge"},{"cle":"matiere","libelle":"Tissu","type":"texte","aide":"Ex. wax, bazin, coton"}]'::jsonb, updated_at = NOW()
 WHERE slug = 'mode-femme' AND specifications = '[]'::jsonb;

UPDATE categorie SET specifications = '[{"cle":"tailles","libelle":"Tailles","type":"variantes","options":[],"libre":true,"aide":"Ex. S, M, L, XL"},{"cle":"couleurs","libelle":"Couleurs","type":"variantes","options":[],"libre":true,"aide":"Ex. Noir, Blanc, Rouge"},{"cle":"matiere","libelle":"Tissu","type":"texte","aide":"Ex. wax, bazin, coton"}]'::jsonb, updated_at = NOW()
 WHERE slug = 'mode-homme' AND specifications = '[]'::jsonb;

UPDATE categorie SET specifications = '[{"cle":"pointures","libelle":"Pointures","type":"variantes","options":[],"libre":true,"aide":"Ex. 38, 39, 40"},{"cle":"couleurs","libelle":"Couleurs","type":"variantes","options":[],"libre":true,"aide":"Ex. Noir, Blanc, Rouge"},{"cle":"matiere","libelle":"Matière","type":"texte"}]'::jsonb, updated_at = NOW()
 WHERE slug = 'chaussures-sacs' AND specifications = '[]'::jsonb;

UPDATE categorie SET specifications = '[{"cle":"contenances","libelle":"Contenances","type":"variantes","options":[],"libre":true,"aide":"Ex. 100 ml, 250 ml"},{"cle":"teintes","libelle":"Teintes ou parfums","type":"variantes","options":[],"libre":true}]'::jsonb, updated_at = NOW()
 WHERE slug = 'beaute-cosmetiques' AND specifications = '[]'::jsonb;

UPDATE categorie SET specifications = '[{"cle":"tailles","libelle":"Tailles","type":"variantes","options":[],"libre":true,"aide":"Ex. S, M, L, XL"},{"cle":"couleurs","libelle":"Couleurs","type":"variantes","options":[],"libre":true,"aide":"Ex. Noir, Blanc, Rouge"},{"cle":"matiere","libelle":"Matière","type":"texte","aide":"Ex. or, argent, perles"}]'::jsonb, updated_at = NOW()
 WHERE slug = 'bijoux-accessoires' AND specifications = '[]'::jsonb;

UPDATE categorie SET specifications = '[{"cle":"marque","libelle":"Marque","type":"texte","aide":"Ex. Samsung, Tecno"},{"cle":"etat","libelle":"État","type":"texte","aide":"Ex. neuf, occasion"},{"cle":"capacites","libelle":"Capacités","type":"variantes","options":[],"libre":true,"aide":"Ex. 64 Go, 128 Go"},{"cle":"couleurs","libelle":"Couleurs","type":"variantes","options":[],"libre":true,"aide":"Ex. Noir, Blanc, Rouge"},{"cle":"garantie","libelle":"Garantie","type":"texte","aide":"Ex. 6 mois"}]'::jsonb, updated_at = NOW()
 WHERE slug = 'telephones-electronique' AND specifications = '[]'::jsonb;

UPDATE categorie SET specifications = '[{"cle":"dimensions","libelle":"Dimensions","type":"variantes","options":[],"libre":true,"aide":"Ex. 120 × 60 cm"},{"cle":"couleurs","libelle":"Couleurs","type":"variantes","options":[],"libre":true,"aide":"Ex. Noir, Blanc, Rouge"},{"cle":"matiere","libelle":"Matière","type":"texte"}]'::jsonb, updated_at = NOW()
 WHERE slug = 'maison-deco' AND specifications = '[]'::jsonb;

UPDATE categorie SET specifications = '[{"cle":"formats","libelle":"Poids ou formats","type":"variantes","options":[],"libre":true,"aide":"Ex. 1 kg, 5 kg, 25 kg"}]'::jsonb, updated_at = NOW()
 WHERE slug = 'alimentation-epicerie' AND specifications = '[]'::jsonb;

UPDATE categorie SET specifications = '[{"cle":"portions","libelle":"Portions","type":"variantes","options":[],"libre":true,"aide":"Ex. petite, grande, familiale"},{"cle":"accompagnements","libelle":"Accompagnements","type":"variantes","options":[],"libre":true,"aide":"Ex. riz, attiéké, frites"}]'::jsonb, updated_at = NOW()
 WHERE slug = 'plats-traiteur' AND specifications = '[]'::jsonb;

UPDATE categorie SET specifications = '[{"cle":"parfums","libelle":"Parfums","type":"variantes","options":[],"libre":true,"aide":"Ex. bissap, bouye, gingembre"},{"cle":"formats","libelle":"Formats","type":"variantes","options":[],"libre":true,"aide":"Ex. 50 cl, 1 L, 1,5 L"}]'::jsonb, updated_at = NOW()
 WHERE slug = 'jus-boissons' AND specifications = '[]'::jsonb;

UPDATE categorie SET specifications = '[{"cle":"tailles","libelle":"Tailles","type":"variantes","options":[],"libre":true,"aide":"Ex. 6 parts, 10 parts"},{"cle":"parfums","libelle":"Parfums","type":"variantes","options":[],"libre":true,"aide":"Ex. vanille, chocolat"}]'::jsonb, updated_at = NOW()
 WHERE slug = 'patisserie-gateaux' AND specifications = '[]'::jsonb;

UPDATE categorie SET specifications = '[{"cle":"ages","libelle":"Âges ou tailles","type":"variantes","options":[],"libre":true,"aide":"Ex. 0-3 mois, 2 ans, 4 ans"},{"cle":"couleurs","libelle":"Couleurs","type":"variantes","options":[],"libre":true,"aide":"Ex. Noir, Blanc, Rouge"}]'::jsonb, updated_at = NOW()
 WHERE slug = 'enfants-bebes' AND specifications = '[]'::jsonb;

UPDATE categorie SET specifications = '[{"cle":"contenances","libelle":"Contenances","type":"variantes","options":[],"libre":true,"aide":"Ex. 60 gélules, 500 ml"}]'::jsonb, updated_at = NOW()
 WHERE slug = 'sante-bien-etre' AND specifications = '[]'::jsonb;

UPDATE categorie SET specifications = '[{"cle":"tailles","libelle":"Tailles","type":"variantes","options":[],"libre":true,"aide":"Ex. S, M, L, XL"},{"cle":"couleurs","libelle":"Couleurs","type":"variantes","options":[],"libre":true,"aide":"Ex. Noir, Blanc, Rouge"}]'::jsonb, updated_at = NOW()
 WHERE slug = 'sport-loisirs' AND specifications = '[]'::jsonb;

UPDATE categorie SET specifications = '[{"cle":"couleurs","libelle":"Couleurs","type":"variantes","options":[],"libre":true,"aide":"Ex. Noir, Blanc, Rouge"},{"cle":"dimensions","libelle":"Dimensions","type":"texte"},{"cle":"matiere","libelle":"Matière","type":"texte"}]'::jsonb, updated_at = NOW()
 WHERE slug = 'artisanat' AND specifications = '[]'::jsonb;

UPDATE categorie SET specifications = '[{"cle":"formules","libelle":"Formules","type":"variantes","options":[],"libre":true,"aide":"Ex. simple, complète"},{"cle":"zone","libelle":"Zone","type":"texte","aide":"Ex. Dakar et banlieue"}]'::jsonb, updated_at = NOW()
 WHERE slug = 'services' AND specifications = '[]'::jsonb;

COMMIT;
