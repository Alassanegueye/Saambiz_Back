-- =====================================================================
--  Migration SaamBiz — structure des catégories (un seul niveau)
--
--  Choix retenu : PAS de rayons ni de sous-rayons. Une liste courte de
--  catégories (une quinzaine), qu'on parcourt d'un coup d'œil sur un
--  téléphone :
--    • une boutique appartient à 1 à 3 catégories (table boutique_categorie,
--      dont UNE principale) ;
--    • un produit appartient à une seule catégorie (produit.categorie_id,
--      inchangé).
--
--  Tout se gère ensuite depuis le dashboard admin : renommer, réordonner,
--  masquer, changer l'icône, fusionner. D'où les colonnes ajoutées ici :
--    slug   identifiant stable (ne change pas quand on renomme) ;
--    icone  nom d'icône Material, interprété par l'application ;
--    image  visuel optionnel (URL) pour les tuiles de l'accueil ;
--    ordre  position dans la liste ;
--    active une catégorie masquée disparaît de l'app sans rien casser.
--
--  Reprise de l'existant :
--    • les anciennes catégories sont RENOMMÉES (leurs produits suivent) ;
--    • « Mode & Vêtements » est scindée en Mode femme / Mode homme : on ne
--      peut pas deviner où va chaque produit, donc l'ancienne ligne est
--      MASQUÉE et ses produits restent rattachés ; l'admin les réaffecte
--      en la supprimant avec « remplacer par » ;
--    • boutique.categorie (texte libre) est traduit en liens
--      boutique_categorie, puis ramené au nom exact de la catégorie
--      principale ;
--    • les centres d'intérêt et affinités des clients, stockés par nom,
--      sont traduits vers les nouveaux noms.
--
--  Idempotent : peut être relancé sans risque.
--    psql "$DATABASE_URL" -f migrations/20261019_structure_categories.sql
-- =====================================================================

BEGIN;

-- ── 1. Colonnes de gestion ────────────────────────────────────────────
ALTER TABLE categorie ADD COLUMN IF NOT EXISTS slug   VARCHAR(80);
ALTER TABLE categorie ADD COLUMN IF NOT EXISTS icone  VARCHAR(40);
ALTER TABLE categorie ADD COLUMN IF NOT EXISTS image  VARCHAR(500);
ALTER TABLE categorie ADD COLUMN IF NOT EXISTS ordre  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE categorie ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS categorie_slug_unique
  ON categorie (slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS categorie_active_ordre_idx
  ON categorie (active, ordre);

-- ── 2. Référentiel ────────────────────────────────────────────────────
CREATE TEMP TABLE _cat_ref (slug, nom, description, icone, ordre) ON COMMIT DROP AS
SELECT * FROM (VALUES
  ('mode-femme',              'Mode femme',                'Robes, boubous, pagnes, ensembles et prêt-à-porter femme', 'checkroom',       1),
  ('mode-homme',              'Mode homme',                'Chemises, pantalons, boubous et prêt-à-porter homme',      'man',             2),
  ('chaussures-sacs',         'Chaussures & sacs',         'Chaussures, sandales, sacs et maroquinerie',               'shopping_bag',    3),
  ('beaute-cosmetiques',      'Beauté & cosmétiques',      'Soins, maquillage, parfums, cheveux et mèches',            'spa',             4),
  ('bijoux-accessoires',      'Bijoux & accessoires',      'Bijoux, montres, lunettes et accessoires',                 'diamond',         5),
  ('telephones-electronique', 'Téléphones & électronique', 'Téléphones, accessoires, informatique et électroménager',  'smartphone',      6),
  ('maison-deco',             'Maison & déco',             'Décoration, linge de maison, cuisine et mobilier',         'chair',           7),
  ('alimentation-epicerie',   'Alimentation & épicerie',   'Épicerie, produits frais, boissons et plats préparés',     'shopping_basket', 8),
  ('enfants-bebes',           'Enfants & bébés',           'Vêtements, jouets et puériculture',                        'child_care',      9),
  ('sante-bien-etre',         'Santé & bien-être',         'Hygiène, parapharmacie et bien-être',                      'favorite',       10),
  ('sport-loisirs',           'Sport & loisirs',           'Équipements de sport, loisirs et plein air',               'sports_soccer',  11),
  ('artisanat',               'Artisanat & fait main',     'Créations artisanales et produits faits main',             'palette',        12),
  ('services',                'Services',                  'Couture, coiffure, réparation et autres prestations',      'handyman',       13),
  ('autre',                   'Autre',                     'Ce qui ne rentre dans aucune autre catégorie',             'more_horiz',     14)
) AS v(slug, nom, description, icone, ordre);

-- Libellés connus → slug. Couvre les anciennes catégories de la base ET
-- les libellés que l'application envoyait jusqu'ici ('Mode', 'Beauté'…).
-- rang 1 = catégorie principale quand un libellé en donne plusieurs.
CREATE TEMP TABLE _cat_alias (libelle, slug, rang) ON COMMIT DROP AS
SELECT * FROM (VALUES
  ('mode & vêtements',      'mode-femme',              1),
  ('mode & vêtements',      'mode-homme',              2),
  ('mode',                  'mode-femme',              1),
  ('mode',                  'mode-homme',              2),
  ('vêtements',             'mode-femme',              1),
  ('vêtements',             'mode-homme',              2),
  ('chaussures',            'chaussures-sacs',         1),
  ('sacs',                  'chaussures-sacs',         1),
  ('beauté',                'beaute-cosmetiques',      1),
  ('beaute',                'beaute-cosmetiques',      1),
  ('cosmétiques',           'beaute-cosmetiques',      1),
  ('électronique',          'telephones-electronique', 1),
  ('electronique',          'telephones-electronique', 1),
  ('téléphones',            'telephones-electronique', 1),
  ('maison',                'maison-deco',             1),
  ('alimentation',          'alimentation-epicerie',   1),
  ('épicerie',              'alimentation-epicerie',   1),
  ('enfants & bébé',        'enfants-bebes',           1),
  ('enfants',               'enfants-bebes',           1),
  ('bijoux',                'bijoux-accessoires',      1),
  ('santé',                 'sante-bien-etre',         1),
  ('sport',                 'sport-loisirs',           1),
  ('artisanat',             'artisanat',               1),
  ('autres',                'autre',                   1)
) AS v(libelle, slug, rang);

-- ── 3. Anciennes catégories renommées (leurs produits suivent) ────────
UPDATE categorie c
   SET nom = r.nom, slug = r.slug, updated_at = NOW()
  FROM (VALUES
    ('Beauté & Cosmétiques',  'beaute-cosmetiques'),
    ('Électronique',          'telephones-electronique'),
    ('Maison & Déco',         'maison-deco'),
    ('Alimentation',          'alimentation-epicerie'),
    ('Sport & Loisirs',       'sport-loisirs'),
    ('Enfants & Bébé',        'enfants-bebes'),
    ('Bijoux & Accessoires',  'bijoux-accessoires'),
    ('Artisanat & Fait main', 'artisanat'),
    ('Santé & Bien-être',     'sante-bien-etre'),
    ('Services',              'services'),
    ('Autres',                'autre')
  ) AS m(ancien, slug)
  JOIN _cat_ref r ON r.slug = m.slug
 WHERE c.nom = m.ancien
   AND c.slug IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM categorie x
      WHERE x.id <> c.id AND (x.slug = r.slug OR x.nom = r.nom)
   );

-- Ligne portant déjà le bon nom (éventuellement supprimée) : on la reprend
-- plutôt que d'en créer une seconde, que l'unicité du nom refuserait.
UPDATE categorie c
   SET slug = r.slug, deleted_at = NULL, updated_at = NOW()
  FROM _cat_ref r
 WHERE c.nom = r.nom
   AND c.slug IS NULL
   AND NOT EXISTS (SELECT 1 FROM categorie x WHERE x.slug = r.slug);

-- ── 4. Catégories manquantes ──────────────────────────────────────────
-- md5() plutôt que gen_random_uuid() : pgcrypto n'est pas garanti avant
-- PostgreSQL 13 sur tous les hébergements.
INSERT INTO categorie (id, nom, slug, description, icone, ordre, active, created_at, updated_at)
SELECT md5(random()::text || clock_timestamp()::text || r.slug)::uuid,
       r.nom, r.slug, r.description, r.icone, r.ordre, TRUE, NOW(), NOW()
  FROM _cat_ref r
 WHERE NOT EXISTS (
   SELECT 1 FROM categorie c WHERE c.slug = r.slug OR c.nom = r.nom
 );

-- Présentation du référentiel (description, icône, ordre).
UPDATE categorie c
   SET description = r.description,
       icone       = COALESCE(c.icone, r.icone),
       ordre       = r.ordre,
       active      = TRUE,
       deleted_at  = NULL,
       updated_at  = NOW()
  FROM _cat_ref r
 WHERE c.slug = r.slug;

-- ── 5. Catégories hors référentiel ────────────────────────────────────
-- « Mode & Vêtements » : scindée, donc masquée (ses produits restent).
UPDATE categorie
   SET active = FALSE, ordre = 900, updated_at = NOW()
 WHERE nom = 'Mode & Vêtements' AND slug IS NULL;

-- Toute autre catégorie créée à la main reçoit un slug et passe après
-- le référentiel, sans être masquée.
DO $$
DECLARE
  ligne RECORD;
  base  TEXT;
  final TEXT;
BEGIN
  FOR ligne IN SELECT id, nom, active FROM categorie WHERE slug IS NULL LOOP
    base := lower(ligne.nom);
    base := translate(base,
              'àáâãäåçèéêëìíîïñòóôõöùúûüýÿ',
              'aaaaaaceeeeiiiinooooouuuuyy');
    base := regexp_replace(base, '[^a-z0-9]+', '-', 'g');
    base := regexp_replace(base, '(^-+|-+$)', '', 'g');
    IF base = '' THEN base := 'categorie'; END IF;
    final := left(base, 70);
    IF EXISTS (SELECT 1 FROM categorie WHERE slug = final) THEN
      final := left(base, 61) || '-' || left(replace(ligne.id::text, '-', ''), 8);
    END IF;
    UPDATE categorie
       SET slug = final,
           ordre = CASE WHEN ordre = 0 THEN 100 ELSE ordre END
     WHERE id = ligne.id;
  END LOOP;
END $$;

-- Le nom exact de chaque catégorie vaut aussi libellé.
INSERT INTO _cat_alias (libelle, slug, rang)
SELECT lower(btrim(c.nom)), c.slug, 1
  FROM categorie c
 WHERE c.slug IS NOT NULL
   AND c.active
   AND c.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM _cat_alias a WHERE a.libelle = lower(btrim(c.nom)));

-- ── 6. Catégories des boutiques (1 à 3, dont une principale) ──────────
CREATE TABLE IF NOT EXISTS boutique_categorie (
  boutique_id  UUID        NOT NULL REFERENCES boutique(id)  ON DELETE CASCADE ON UPDATE CASCADE,
  categorie_id UUID        NOT NULL REFERENCES categorie(id) ON DELETE CASCADE ON UPDATE CASCADE,
  principale   BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (boutique_id, categorie_id)
);
-- Au démarrage, sync() a pu créer la table depuis le modèle, sans valeurs
-- par défaut côté base : on les pose dans tous les cas.
ALTER TABLE boutique_categorie ALTER COLUMN principale SET DEFAULT FALSE;
ALTER TABLE boutique_categorie ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE boutique_categorie ALTER COLUMN updated_at SET DEFAULT NOW();

CREATE INDEX IF NOT EXISTS boutique_categorie_categorie_idx
  ON boutique_categorie (categorie_id);
-- Une seule catégorie principale par boutique. Le plafond de trois
-- catégories est tenu par le service (message clair pour le vendeur).
CREATE UNIQUE INDEX IF NOT EXISTS boutique_categorie_une_principale
  ON boutique_categorie (boutique_id) WHERE principale;

-- a) Depuis le texte libre boutique.categorie.
INSERT INTO boutique_categorie (boutique_id, categorie_id, principale)
SELECT b.id, c.id, (a.rang = 1)
  FROM boutique b
  JOIN _cat_alias a ON a.libelle = lower(btrim(b.categorie))
  JOIN categorie c  ON c.slug = a.slug AND c.deleted_at IS NULL
 WHERE NOT EXISTS (SELECT 1 FROM boutique_categorie x WHERE x.boutique_id = b.id)
ON CONFLICT DO NOTHING;

-- b) Texte non reconnu : « Autre », plutôt qu'une boutique sans catégorie.
INSERT INTO boutique_categorie (boutique_id, categorie_id, principale)
SELECT b.id, c.id, TRUE
  FROM boutique b
  JOIN categorie c ON c.slug = 'autre'
 WHERE btrim(COALESCE(b.categorie, '')) <> ''
   AND NOT EXISTS (SELECT 1 FROM boutique_categorie x WHERE x.boutique_id = b.id)
ON CONFLICT DO NOTHING;

-- c) Rien de renseigné : la catégorie la plus fréquente de ses produits.
INSERT INTO boutique_categorie (boutique_id, categorie_id, principale)
SELECT DISTINCT ON (b.id) b.id, cible.id, TRUE
  FROM boutique b
  JOIN produit p       ON p.vendeur_id = b.vendeur_id AND p.deleted_at IS NULL
  JOIN categorie ancien ON ancien.id = p.categorie_id
  JOIN _cat_alias a     ON a.libelle = lower(btrim(ancien.nom)) AND a.rang = 1
  JOIN categorie cible  ON cible.slug = a.slug AND cible.active AND cible.deleted_at IS NULL
 WHERE NOT EXISTS (SELECT 1 FROM boutique_categorie x WHERE x.boutique_id = b.id)
 GROUP BY b.id, cible.id
 ORDER BY b.id, COUNT(*) DESC
ON CONFLICT DO NOTHING;

-- boutique.categorie reste lisible par les anciens écrans : il porte
-- désormais le nom exact de la catégorie principale.
UPDATE boutique b
   SET categorie = c.nom
  FROM boutique_categorie bc
  JOIN categorie c ON c.id = bc.categorie_id
 WHERE bc.boutique_id = b.id
   AND bc.principale
   AND b.categorie IS DISTINCT FROM c.nom;

-- ── 7. Préférences clients (stockées par nom) ─────────────────────────
UPDATE preference_client p
   SET interets = COALESCE((
         SELECT jsonb_agg(s.nom ORDER BY s.pos, s.rang)
           FROM (
             SELECT DISTINCT ON (c.nom) c.nom, e.pos, a.rang
               FROM jsonb_array_elements_text(p.interets) WITH ORDINALITY AS e(val, pos)
               JOIN _cat_alias a ON a.libelle = lower(btrim(e.val))
               JOIN categorie c  ON c.slug = a.slug
              ORDER BY c.nom, e.pos, a.rang
           ) s
       ), '[]'::jsonb)
 WHERE jsonb_typeof(p.interets) = 'array'
   AND jsonb_array_length(p.interets) > 0;

UPDATE preference_client p
   SET affinites = COALESCE((
         SELECT jsonb_object_agg(s.cle, s.score)
           FROM (
             SELECT COALESCE(c.nom, e.key) AS cle, MAX(e.value::numeric) AS score
               FROM jsonb_each_text(p.affinites) AS e(key, value)
               LEFT JOIN _cat_alias a ON a.libelle = lower(btrim(e.key))
               LEFT JOIN categorie c  ON c.slug = a.slug
              WHERE e.value ~ '^-?[0-9]+(\.[0-9]+)?$'
              GROUP BY 1
           ) s
       ), '{}'::jsonb)
 WHERE jsonb_typeof(p.affinites) = 'object'
   AND p.affinites <> '{}'::jsonb;

COMMIT;
