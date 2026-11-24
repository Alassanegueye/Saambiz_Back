-- Le suivi d'une commande passée sans compte.
--
-- Un client du site d'une boutique n'a pas de compte : il ne pouvait donc
-- revenir voir sa commande qu'avec sa référence et son numéro de téléphone.
-- Deux valeurs courtes, qui circulent par WhatsApp, se recopient dans des
-- conversations de groupe et s'essaient l'une après l'autre.
--
-- À la place, un lien unique envoyé par email. La table ne garde que
-- l'empreinte SHA-256 du jeton : une copie de la base ne permet pas d'en
-- fabriquer un, et il n'y a aucune clé de déchiffrement à voler puisque rien
-- n'est chiffré — le jeton ne signifie rien, il désigne une ligne.

CREATE TABLE IF NOT EXISTS lien_suivi (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- L'adresse qui a commandé : c'est elle que le lien ouvre, et c'est elle
  -- qu'on redemande quand il a expiré.
  email          VARCHAR(255) NOT NULL,

  -- SHA-256 en hexadécimal : 64 caractères. Jamais le jeton lui-même.
  jeton_hash     VARCHAR(64)  NOT NULL,

  expires_at     TIMESTAMPTZ  NOT NULL,

  -- La commande à l'origine du lien, pour l'ouvrir directement sur celle-là.
  -- Nulle quand le lien vient d'une demande « j'ai perdu mon lien ».
  -- ON DELETE SET NULL : la commande peut disparaître, le lien reste valable
  -- pour les autres commandes de la même adresse.
  commande_id    UUID NULL REFERENCES commande(id) ON DELETE SET NULL,

  derniere_utilisation TIMESTAMPTZ NULL,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- L'unicité est une garantie, pas une optimisation : deux liens ne doivent
-- jamais porter la même empreinte, et c'est par elle qu'on les retrouve.
CREATE UNIQUE INDEX IF NOT EXISTS lien_suivi_jeton_hash_idx ON lien_suivi (jeton_hash);

-- Retrouver les liens d'une adresse : élagage, et renvoi d'un nouveau lien.
CREATE INDEX IF NOT EXISTS lien_suivi_email_idx ON lien_suivi (email);

-- Balayage des liens périmés.
CREATE INDEX IF NOT EXISTS lien_suivi_expires_at_idx ON lien_suivi (expires_at);
