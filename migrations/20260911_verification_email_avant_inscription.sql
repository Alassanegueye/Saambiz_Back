-- =====================================================================
--  Migration SaamBiz — vérifier l'adresse AVANT de créer le compte
--
--  Jusqu'ici, `register` créait le compte puis envoyait un code : une
--  adresse jamais confirmée laissait une ligne utilisateur définitive,
--  et rien n'empêchait de se connecter sans avoir vérifié quoi que ce
--  soit. Le compte n'est désormais créé qu'une fois le code validé.
--
--  Les codes en attente ne peuvent pas vivre dans `user_otp` : cette
--  table exige un `utilisateur_id`, et c'est précisément ce qui n'existe
--  pas encore. D'où cette table, dont les lignes sont éphémères.
--
--  Idempotent : peut être relancé sans risque.
--    psql "$DATABASE_URL" -f migrations/20260911_verification_email_avant_inscription.sql
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS verification_email (
  -- Une seule vérification en cours par adresse : redemander un code
  -- remplace le précédent, il n'y a jamais deux codes valides à la fois.
  email           VARCHAR(255) PRIMARY KEY,

  -- Le code n'est jamais stocké en clair : il tient en six chiffres, et une
  -- copie de la base suffirait sinon à valider n'importe quelle adresse.
  code_hash       VARCHAR(255) NOT NULL,
  expires_at      TIMESTAMPTZ  NOT NULL,

  -- Plafond d'essais : six chiffres se devinent en un million de coups, ce
  -- qui est peu pour une machine. Au-delà, il faut redemander un code.
  tentatives      SMALLINT     NOT NULL DEFAULT 0,

  -- Remis à l'application une fois le code validé, et réclamé par
  -- `register`. Il lie la création du compte À CETTE vérification-là :
  -- sans lui, un tiers qui connaît l'adresse pourrait s'inscrire à sa
  -- place dans les minutes qui suivent. Stocké en SHA-256, comme les
  -- jetons de rafraîchissement — c'est déjà une valeur aléatoire.
  jeton_hash      VARCHAR(64),
  jeton_expire_le TIMESTAMPTZ,

  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Purge des vérifications abandonnées : la grande majorité des lignes, un
-- code demandé n'étant pas toujours saisi.
CREATE INDEX IF NOT EXISTS idx_verification_email_expiration
  ON verification_email (expires_at);

COMMIT;
