-- =====================================================================
--  Migration SaamBiz — catégories pour la nourriture et les boissons
--
--  Beaucoup de vendeurs ne vendent pas des articles mais à manger et à
--  boire : plats du jour, thiéboudienne à emporter, traiteur, jus locaux
--  (bissap, bouye, gingembre, ditakh), pâtisseries… Les ranger dans
--  « Alimentation & épicerie » les noyait au milieu du riz et de l'huile,
--  et un client qui cherche son déjeuner ne cherche pas une épicerie.
--
--  Trois catégories dédiées, placées juste après l'épicerie :
--    • Plats & traiteur      (restaurant)
--    • Jus & boissons        (local_drink)
--    • Pâtisserie & gâteaux  (cake)
--  L'épicerie se recentre sur les produits à cuisiner.
--
--  Les catégories existantes ne sont pas recréées ; seul l'ordre du
--  référentiel est recalé pour faire de la place. Une catégorie ajoutée à
--  la main depuis le dashboard garde son ordre.
--
--  Idempotent : peut être relancé sans risque.
-- =====================================================================

BEGIN;

CREATE TEMP TABLE _cat_ref (slug, nom, description, icone, ordre) ON COMMIT DROP AS
SELECT * FROM (VALUES
  ('mode-femme',              'Mode femme',                NULL, NULL,  1),
  ('mode-homme',              'Mode homme',                NULL, NULL,  2),
  ('chaussures-sacs',         'Chaussures & sacs',         NULL, NULL,  3),
  ('beaute-cosmetiques',      'Beauté & cosmétiques',      NULL, NULL,  4),
  ('bijoux-accessoires',      'Bijoux & accessoires',      NULL, NULL,  5),
  ('telephones-electronique', 'Téléphones & électronique', NULL, NULL,  6),
  ('maison-deco',             'Maison & déco',             NULL, NULL,  7),
  ('alimentation-epicerie',   'Alimentation & épicerie',
     'Épicerie, céréales, produits frais et produits locaux à cuisiner', NULL, 8),
  ('plats-traiteur',          'Plats & traiteur',
     'Plats cuisinés, plats du jour, fast-food, traiteur et repas livrés', 'restaurant', 9),
  ('jus-boissons',            'Jus & boissons',
     'Bissap, bouye, gingembre, ditakh, jus frais et boissons',            'local_drink', 10),
  ('patisserie-gateaux',      'Pâtisserie & gâteaux',
     'Gâteaux, pâtisseries, beignets, desserts et commandes d''événements', 'cake', 11),
  ('enfants-bebes',           'Enfants & bébés',           NULL, NULL, 12),
  ('sante-bien-etre',         'Santé & bien-être',         NULL, NULL, 13),
  ('sport-loisirs',           'Sport & loisirs',           NULL, NULL, 14),
  ('artisanat',               'Artisanat & fait main',     NULL, NULL, 15),
  ('services',                'Services',                  NULL, NULL, 16),
  ('autre',                   'Autre',                     NULL, NULL, 17)
) AS v(slug, nom, description, icone, ordre);

-- Nouvelles catégories (rien si elles existent déjà, même supprimées).
INSERT INTO categorie (id, nom, slug, description, icone, ordre, active, created_at, updated_at)
SELECT md5(random()::text || clock_timestamp()::text || r.slug)::uuid,
       r.nom, r.slug, r.description, r.icone, r.ordre, TRUE, NOW(), NOW()
  FROM _cat_ref r
 WHERE r.icone IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM categorie c WHERE c.slug = r.slug OR c.nom = r.nom);

-- Ordre du référentiel recalé ; description de l'épicerie recentrée.
UPDATE categorie c
   SET ordre = r.ordre,
       description = COALESCE(r.description, c.description),
       updated_at = NOW()
  FROM _cat_ref r
 WHERE c.slug = r.slug;

-- Boutiques déjà classées « Autre » ou « Alimentation » dont le nom parle
-- clairement de repas, de jus ou de pâtisserie : on ajoute la bonne
-- catégorie (sans retirer l'ancienne, dans la limite de trois).
WITH indices (motif, slug, priorite) AS (
  VALUES
    ('(restaurant|resto|traiteur|plat|cuisine|thi[eé]b|yassa|maf[eé]|dibi|fast.?food|grill|snack)', 'plats-traiteur', 1),
    ('(jus|bissap|bouye|gingembre|ditakh|boisson|smoothie)',                                 'jus-boissons', 2),
    ('(p[aâ]tisserie|g[aâ]teau|cake|beignet|cr[eê]pe|dessert|boulangerie)',                  'patisserie-gateaux', 3)
), existants AS (
  SELECT boutique_id, COUNT(*) AS nb FROM boutique_categorie GROUP BY boutique_id
), candidates AS (
  SELECT b.id AS boutique_id, c.id AS categorie_id, COALESCE(e.nb, 0) AS nb,
         ROW_NUMBER() OVER (PARTITION BY b.id ORDER BY i.priorite) AS rang
    FROM boutique b
    JOIN indices i   ON lower(b.nom || ' ' || COALESCE(b.description, '') || ' ' || COALESCE(b.slogan, '')) ~ i.motif
    JOIN categorie c ON c.slug = i.slug AND c.active AND c.deleted_at IS NULL
    LEFT JOIN existants e ON e.boutique_id = b.id
   WHERE b.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM boutique_categorie x WHERE x.boutique_id = b.id AND x.categorie_id = c.id)
)
INSERT INTO boutique_categorie (boutique_id, categorie_id, principale)
SELECT boutique_id, categorie_id, (nb = 0 AND rang = 1)
  FROM candidates
 WHERE nb + rang <= 3
ON CONFLICT DO NOTHING;

-- « Autre » n'était qu'un pis-aller : une boutique qui a désormais une
-- vraie catégorie la quitte, et la nouvelle devient sa principale.
CREATE TEMP TABLE _sortie_autre ON COMMIT DROP AS
SELECT bc.boutique_id, bc.principale
  FROM boutique_categorie bc
  JOIN categorie c ON c.id = bc.categorie_id AND c.slug = 'autre'
 WHERE EXISTS (
   SELECT 1 FROM boutique_categorie x
    WHERE x.boutique_id = bc.boutique_id AND x.categorie_id <> bc.categorie_id
 );

DELETE FROM boutique_categorie bc
 USING categorie c, _sortie_autre s
 WHERE c.id = bc.categorie_id AND c.slug = 'autre' AND bc.boutique_id = s.boutique_id;

UPDATE boutique_categorie bc
   SET principale = TRUE, updated_at = NOW()
  FROM (
    SELECT DISTINCT ON (x.boutique_id) x.boutique_id, x.categorie_id
      FROM boutique_categorie x
      JOIN _sortie_autre s ON s.boutique_id = x.boutique_id AND s.principale
      JOIN categorie c ON c.id = x.categorie_id
     ORDER BY x.boutique_id, c.ordre
  ) choix
 WHERE bc.boutique_id = choix.boutique_id AND bc.categorie_id = choix.categorie_id
   AND NOT EXISTS (SELECT 1 FROM boutique_categorie y WHERE y.boutique_id = bc.boutique_id AND y.principale);

-- Le libellé texte suit la principale.
UPDATE boutique b
   SET categorie = c.nom
  FROM boutique_categorie bc
  JOIN categorie c ON c.id = bc.categorie_id
 WHERE bc.boutique_id = b.id AND bc.principale AND b.categorie IS DISTINCT FROM c.nom;

COMMIT;
