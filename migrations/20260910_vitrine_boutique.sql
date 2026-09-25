-- =====================================================================
--  Migration SaamBiz — la vitrine web des boutiques
--
--  Chaque vendeur dispose désormais d'un vrai site pour sa boutique,
--  ouvert au public sans compte : saambiz.sn/b/<slug>. Ses clients y
--  commandent directement, puis sont invités à installer l'application
--  pour suivre la boutique et recevoir ses notifications.
--
--  Trois choses à mettre en base pour cela :
--    1. les réglages d'apparence et de contenu de la vitrine ;
--    2. un slug pour TOUTES les boutiques — c'est l'adresse du site,
--       les boutiques créées avant l'avaient laissé vide ;
--    3. de quoi distinguer une commande venue du site d'une commande
--       passée dans l'application, et un compte créé au passage en
--       caisse d'un compte réellement inscrit.
--
--  Idempotent : peut être relancé sans risque.
--    psql "$DATABASE_URL" -f migrations/20260910_vitrine_boutique.sql
-- =====================================================================

BEGIN;

-- ── 1. Réglages de la vitrine ────────────────────────────────────────
-- Le vendeur ne choisit pas un « template » parmi des sites entiers : il
-- règle un moteur unique. Trois mises en page, une couleur d'accent, des
-- sections qu'on allume ou qu'on éteint. Une seule base de code à tenir,
-- et un vendeur qui gère tout depuis son téléphone n'a pas à comparer des
-- maquettes pour ouvrir son site.

-- Le site est-il publié ? Un vendeur peut préparer sa vitrine avant de
-- l'ouvrir, ou la fermer sans fermer sa boutique dans l'application.
ALTER TABLE boutique ADD COLUMN IF NOT EXISTS vitrine_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Mise en page : 'classique' | 'galerie' | 'catalogue'.
-- VARCHAR et non ENUM : ajouter une mise en page ne doit pas demander une
-- migration de type, qui verrouille la table le temps du déploiement.
ALTER TABLE boutique ADD COLUMN IF NOT EXISTS vitrine_modele VARCHAR(20) NOT NULL DEFAULT 'classique';

-- Couleur d'accent du site. Distincte de couleur_theme, qui pilote déjà
-- l'affichage de la boutique DANS l'application : un vendeur peut vouloir
-- son site plus sobre que sa fiche, ou l'inverse.
ALTER TABLE boutique ADD COLUMN IF NOT EXISTS vitrine_accent VARCHAR(9);

ALTER TABLE boutique ADD COLUMN IF NOT EXISTS vitrine_apropos  TEXT;
ALTER TABLE boutique ADD COLUMN IF NOT EXISTS vitrine_annonce  VARCHAR(180);
ALTER TABLE boutique ADD COLUMN IF NOT EXISTS vitrine_horaires VARCHAR(160);

-- { "facebook": "...", "instagram": "...", "tiktok": "...", "site": "..." }
ALTER TABLE boutique ADD COLUMN IF NOT EXISTS vitrine_reseaux  JSONB;

-- { "apropos": true, "avis": true, "contact": true, "categories": true }
ALTER TABLE boutique ADD COLUMN IF NOT EXISTS vitrine_sections JSONB;

-- Le site peut rester une vitrine sans caisse : certains vendeurs veulent
-- montrer leur catalogue et être appelés sur WhatsApp, rien de plus.
ALTER TABLE boutique ADD COLUMN IF NOT EXISTS vitrine_commande BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE boutique ADD COLUMN IF NOT EXISTS vitrine_paiement_livraison BOOLEAN NOT NULL DEFAULT TRUE;

-- Compteur de visites du site, affiché au vendeur à côté des vues produits.
ALTER TABLE boutique ADD COLUMN IF NOT EXISTS vitrine_vues INTEGER NOT NULL DEFAULT 0;

-- ── 2. Un slug pour chaque boutique ──────────────────────────────────
-- Le slug est l'adresse publique du site : sans lui, pas de vitrine. Les
-- boutiques créées avant l'ont laissé NULL. On le calcule depuis le nom.
--
-- Les accents sont retirés par translate() plutôt que par unaccent() :
-- l'extension unaccent n'est pas garantie présente sur l'hébergement, et
-- une migration qui échoue au démarrage bloque tout le conteneur.
DO $$
DECLARE
  ligne   RECORD;
  base    TEXT;
  essai   TEXT;
  suffixe INT;
BEGIN
  FOR ligne IN SELECT id, nom FROM boutique WHERE slug IS NULL OR slug = '' LOOP
    base := lower(coalesce(ligne.nom, 'boutique'));
    base := translate(base,
              'àáâãäåçèéêëìíîïñòóôõöùúûüýÿ',
              'aaaaaaceeeeiiiinooooouuuuyy');
    base := regexp_replace(base, '[^a-z0-9]+', '-', 'g');
    base := regexp_replace(base, '(^-+|-+$)', '', 'g');
    base := left(base, 60);
    IF base = '' THEN base := 'boutique'; END IF;

    essai   := base;
    suffixe := 1;
    WHILE EXISTS (SELECT 1 FROM boutique WHERE slug = essai) LOOP
      suffixe := suffixe + 1;
      essai   := base || '-' || suffixe;
    END LOOP;

    UPDATE boutique SET slug = essai WHERE id = ligne.id;
  END LOOP;
END $$;

-- Chaque affichage du site part du slug : sans index, chaque visite lit la
-- table entière. La contrainte d'unicité est déjà portée par la colonne.
CREATE INDEX IF NOT EXISTS idx_boutique_slug ON boutique (slug);

-- ── 3. Provenance des commandes et comptes créés en caisse ───────────
-- Le vendeur doit voir d'où vient une commande : son site, l'application,
-- ou son propre tableau de bord. C'est ce qui lui dit si sa vitrine sert.
ALTER TABLE commande ADD COLUMN IF NOT EXISTS origine VARCHAR(20) NOT NULL DEFAULT 'application';

-- Un client qui commande sur le site donne son nom et son téléphone, pas
-- un mot de passe. On lui ouvre quand même un compte : c'est ce qui lui
-- permettra de retrouver ses commandes le jour où il installe
-- l'application, et c'est l'argument de l'encart de téléchargement en bas
-- du site. Le drapeau distingue ce compte d'une inscription volontaire —
-- il ne doit jamais pouvoir se connecter par mot de passe tant qu'il n'en
-- a pas choisi un.
ALTER TABLE utilisateur ADD COLUMN IF NOT EXISTS compte_invite BOOLEAN NOT NULL DEFAULT FALSE;

-- Retrouver un client par son téléphone au passage en caisse.
CREATE INDEX IF NOT EXISTS idx_utilisateur_telephone ON utilisateur (telephone);

COMMIT;
