-- =====================================================================
--  Migration SaamBiz — tailles proposées, catégorie « Tissus & pagnes »
--
--  1. Tailles : la case « Tailles » des vêtements reçoit les tailles
--     courantes (XS à 6XL). Le vendeur les coche au lieu de les taper ; il
--     peut toujours écrire la sienne (« 46 », « Taille unique ») : la case
--     reste libre. Une case dont l'admin a déjà rempli les options n'est
--     pas touchée.
--
--  2. Tissus : un tissu ne se vend pas comme un habit. Il a une unité
--     (mètre, yard, pièce de 6 yards…), des modèles ou motifs, une largeur.
--     Il quitte donc les vêtements — la case « Tissu » disparaît des
--     catégories Mode femme et Mode homme — et reçoit sa propre catégorie,
--     placée juste après Mode homme.
--
--     Les produits déjà enregistrés gardent leur valeur « matiere » : elle
--     reste lisible comme une caractéristique ajoutée par le vendeur.
--
--  3. Les boutiques dont le nom parle clairement de tissu reçoivent la
--     nouvelle catégorie, sans en perdre une, dans la limite de trois.
--
--  Source : src/constants/categories.js et specificationsCategories.js.
--  Idempotent : peut être relancé sans risque.
-- =====================================================================

BEGIN;

-- 1. Tailles des vêtements
UPDATE categorie c
   SET specifications = (
         SELECT jsonb_agg(
                  CASE WHEN e->>'cle' = 'tailles' AND COALESCE(jsonb_array_length(e->'options'), 0) = 0
                       THEN e || '{"options":["XS","S","M","L","XL","2XL","3XL","4XL","5XL","6XL"],"libre":true}'::jsonb
                       ELSE e END
                  ORDER BY o)
           FROM jsonb_array_elements(c.specifications) WITH ORDINALITY AS t(e, o)),
       updated_at = NOW()
 WHERE c.slug IN ('mode-femme', 'mode-homme', 'sport-loisirs')
   AND c.specifications @> '[{"cle":"tailles"}]'::jsonb;

-- 2a. La case « Tissu » quitte les vêtements
UPDATE categorie c
   SET specifications = COALESCE((
         SELECT jsonb_agg(e ORDER BY o)
           FROM jsonb_array_elements(c.specifications) WITH ORDINALITY AS t(e, o)
          WHERE NOT (e->>'cle' = 'matiere' AND e->>'libelle' = 'Tissu')), '[]'::jsonb),
       updated_at = NOW()
 WHERE c.slug IN ('mode-femme', 'mode-homme')
   AND c.specifications @> '[{"cle":"matiere","libelle":"Tissu"}]'::jsonb;

-- 2b. La catégorie « Tissus & pagnes », juste après Mode homme (rien si
--     elle existe déjà, même supprimée depuis le dashboard).
UPDATE categorie
   SET ordre = ordre + 1, updated_at = NOW()
 WHERE ordre > (SELECT ordre FROM categorie WHERE slug = 'mode-homme')
   AND NOT EXISTS (SELECT 1 FROM categorie WHERE slug = 'tissus' OR nom = 'Tissus & pagnes');

INSERT INTO categorie (id, nom, slug, description, icone, ordre, active, specifications, created_at, updated_at)
SELECT md5(random()::text || clock_timestamp()::text || 'tissus')::uuid,
       'Tissus & pagnes', 'tissus',
       'Wax, bazin, getzner, soie, lin et pagnes, au mètre, au yard ou à la pièce',
       'content_cut',
       COALESCE((SELECT ordre FROM categorie WHERE slug = 'mode-homme'), 2) + 1,
       TRUE,
       '[{"cle":"unite","libelle":"Vendu au","type":"choix","options":["Mètre","Yard","Pièce de 6 yards","Demi-pièce (3 yards)","Coupon","Rouleau"],"obligatoire":true,"aide":"L''unité de votre prix"},{"cle":"matiere","libelle":"Type de tissu","type":"texte","aide":"Ex. wax, bazin riche, getzner, soie, lin"},{"cle":"modeles","libelle":"Modèles ou motifs","type":"variantes","options":[],"libre":true,"aide":"Ex. motif fleuri, motif 2, uni"},{"cle":"couleurs","libelle":"Couleurs","type":"variantes","options":[],"libre":true,"aide":"Ex. Noir, Blanc, Rouge"},{"cle":"largeur","libelle":"Largeur du tissu","type":"texte","aide":"Ex. 1,15 m"}]'::jsonb,
       NOW(), NOW()
 WHERE NOT EXISTS (SELECT 1 FROM categorie WHERE slug = 'tissus' OR nom = 'Tissus & pagnes');

-- 3. Boutiques de tissus
WITH existants AS (
  SELECT boutique_id, COUNT(*) AS nb FROM boutique_categorie GROUP BY boutique_id
)
INSERT INTO boutique_categorie (boutique_id, categorie_id, principale)
SELECT b.id, c.id, COALESCE(e.nb, 0) = 0
  FROM boutique b
  JOIN categorie c ON c.slug = 'tissus' AND c.active AND c.deleted_at IS NULL
  LEFT JOIN existants e ON e.boutique_id = b.id
 WHERE b.deleted_at IS NULL
   AND lower(b.nom || ' ' || COALESCE(b.description, '') || ' ' || COALESCE(b.slogan, '')) ~ '(tissu|getzner|bazin|pagne)'
   AND COALESCE(e.nb, 0) < 3
   AND NOT EXISTS (SELECT 1 FROM boutique_categorie x WHERE x.boutique_id = b.id AND x.categorie_id = c.id)
ON CONFLICT DO NOTHING;

COMMIT;
