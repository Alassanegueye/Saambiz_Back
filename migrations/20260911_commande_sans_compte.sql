-- =====================================================================
--  Migration SaamBiz — commander sans compte, et sans compte fantôme
--
--  Le site d'une boutique existe pour épargner au client la création
--  d'un compte : il laisse son nom et son numéro, il commande. Jusqu'ici
--  on ouvrait quand même un « compte invité » en coulisse, parce que
--  `commande.acheteur_id` était obligatoire.
--
--  Ce détour ne tient plus : il fabriquait des comptes que personne
--  n'avait demandés, avec des adresses email inventées, et créait un
--  second type de compte à côté des inscriptions réelles. Une seule
--  façon d'avoir un compte désormais : s'inscrire, avec vérification de
--  l'adresse.
--
--  La commande porte donc elle-même les coordonnées du client.
--
--  Idempotent : peut être relancé sans risque.
--    psql "$DATABASE_URL" -f migrations/20260911_commande_sans_compte.sql
-- =====================================================================

BEGIN;

-- ── Les coordonnées du client, sur la commande ───────────────────────
-- Renseignées pour une commande passée depuis le site d'une boutique ;
-- nulles pour une commande passée dans l'application, où elles se lisent
-- sur le compte de l'acheteur.
ALTER TABLE commande ADD COLUMN IF NOT EXISTS client_nom       VARCHAR(120);
ALTER TABLE commande ADD COLUMN IF NOT EXISTS client_prenom    VARCHAR(120);
ALTER TABLE commande ADD COLUMN IF NOT EXISTS client_telephone VARCHAR(20);
ALTER TABLE commande ADD COLUMN IF NOT EXISTS client_email     VARCHAR(255);

-- ── L'acheteur devient facultatif ────────────────────────────────────
-- C'est le cœur du changement : une commande peut n'appartenir à aucun
-- compte. La clé étrangère reste, elle n'est simplement plus exigée.
ALTER TABLE commande ALTER COLUMN acheteur_id DROP NOT NULL;

-- Le suivi se fait par référence + téléphone : sans index, chaque
-- consultation parcourt toute la table des commandes.
CREATE INDEX IF NOT EXISTS idx_commande_client_telephone
  ON commande (client_telephone);

-- ── Reprise des commandes déjà passées en invité ─────────────────────
-- Leurs coordonnées vivent sur le compte fantôme : on les recopie sur la
-- commande avant de supprimer ces comptes, sinon le vendeur perdrait le
-- nom et le numéro de clients qu'il doit livrer.
UPDATE commande c
SET client_nom       = COALESCE(c.client_nom, u.nom),
    client_prenom    = COALESCE(c.client_prenom, u.prenom),
    client_telephone = COALESCE(c.client_telephone, c.numero_telephone, u.telephone)
FROM utilisateur u
WHERE u.id = c.acheteur_id
  AND u.compte_invite = TRUE;

-- La commande ne pointe plus sur le compte fantôme.
UPDATE commande c
SET acheteur_id = NULL
FROM utilisateur u
WHERE u.id = c.acheteur_id
  AND u.compte_invite = TRUE;

-- ── Suppression des comptes fantômes ─────────────────────────────────
-- `paranoid` sur utilisateur : une suppression logique laisserait la
-- ligne et son email inventé. On efface réellement.
DELETE FROM utilisateur WHERE compte_invite = TRUE;

ALTER TABLE utilisateur DROP COLUMN IF EXISTS compte_invite;

COMMIT;
