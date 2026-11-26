-- Sites vitrines suivis par cette API : kodafrik.com et saambiz.com.
--
-- Le site de Kodafrik est hébergé chez LWS, qui n'exécute plus son PHP
-- (403 sur toute page .php) : sa fréquentation, son formulaire de contact et
-- les e-mails du back-office passent désormais ici, comme les visites des
-- boutiques SaamBiz (voir migrations/20261117_visites_boutique.sql).
--
--   site_evenement : chaque page vue, temps passé, clic (WhatsApp, téléphone…)
--   site_message   : les demandes du formulaire de contact
--   site_sel       : le sel du jour qui rend le visiteur anonyme
--   site_mail      : le journal des e-mails envoyés (jamais leur contenu)
--   connexion_utilisateur : chaque connexion réussie (date, appareil)
--
-- Aucun cookie, aucun identifiant durable : le visiteur est compté pour la
-- journée par une empreinte salée (adresse + navigateur + sel tiré au sort
-- chaque jour et effacé le lendemain), impossible à suivre au-delà. L'adresse
-- IP n'est gardée que sans son dernier octet.

CREATE TABLE IF NOT EXISTS site_evenement (
  id BIGSERIAL PRIMARY KEY,
  site VARCHAR(20) NOT NULL,
  cree_le TIMESTAMPTZ NOT NULL DEFAULT now(),
  jour DATE NOT NULL,
  type VARCHAR(10) NOT NULL,
  visite VARCHAR(40) NOT NULL,
  visiteur CHAR(20) NOT NULL,
  chemin VARCHAR(300),
  titre VARCHAR(200),
  cible VARCHAR(120),
  valeur INTEGER,
  entree BOOLEAN NOT NULL DEFAULT false,
  source VARCHAR(80),
  referent VARCHAR(500),
  utm_source VARCHAR(80),
  utm_medium VARCHAR(80),
  utm_campagne VARCHAR(120),
  appareil VARCHAR(20),
  navigateur VARCHAR(40),
  os VARCHAR(20),
  ecran VARCHAR(20),
  langue VARCHAR(20),
  pays VARCHAR(2),
  fuseau VARCHAR(60),
  ip_anonyme VARCHAR(64)
);

CREATE INDEX IF NOT EXISTS site_evenement_site_date ON site_evenement (site, cree_le);
CREATE INDEX IF NOT EXISTS site_evenement_site_visite ON site_evenement (site, visite);
CREATE INDEX IF NOT EXISTS site_evenement_site_type_date ON site_evenement (site, type, cree_le);

CREATE TABLE IF NOT EXISTS site_message (
  id BIGSERIAL PRIMARY KEY,
  site VARCHAR(20) NOT NULL,
  cree_le TIMESTAMPTZ NOT NULL DEFAULT now(),
  nom VARCHAR(120) NOT NULL,
  entreprise VARCHAR(150),
  email VARCHAR(180) NOT NULL,
  telephone VARCHAR(40),
  type VARCHAR(120),
  budget VARCHAR(120),
  message TEXT NOT NULL,
  statut VARCHAR(10) NOT NULL DEFAULT 'nouveau',
  mail_envoye BOOLEAN NOT NULL DEFAULT false,
  visite VARCHAR(40),
  page VARCHAR(300),
  ip_anonyme VARCHAR(64),
  traite_par VARCHAR(160),
  traite_le TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS site_message_site_date ON site_message (site, cree_le);
CREATE INDEX IF NOT EXISTS site_message_site_visite ON site_message (site, visite);

CREATE TABLE IF NOT EXISTS site_sel (
  jour DATE PRIMARY KEY,
  valeur CHAR(32) NOT NULL
);

CREATE TABLE IF NOT EXISTS site_mail (
  id BIGSERIAL PRIMARY KEY,
  site VARCHAR(20) NOT NULL,
  cree_le TIMESTAMPTZ NOT NULL DEFAULT now(),
  modele VARCHAR(40) NOT NULL,
  destinataire VARCHAR(180) NOT NULL,
  sujet VARCHAR(300),
  envoye BOOLEAN NOT NULL DEFAULT false,
  erreur VARCHAR(300),
  par VARCHAR(160)
);

CREATE INDEX IF NOT EXISTS site_mail_site_date ON site_mail (site, cree_le);

-- Les connexions réussies, une ligne chacune : la dernière connexion d'un
-- compte (utilisateur.derniere_connexion) ne dit pas quand il est venu avant.
CREATE TABLE IF NOT EXISTS connexion_utilisateur (
  id BIGSERIAL PRIMARY KEY,
  utilisateur_id UUID NOT NULL REFERENCES utilisateur(id) ON UPDATE CASCADE ON DELETE CASCADE,
  cree_le TIMESTAMPTZ NOT NULL DEFAULT now(),
  application BOOLEAN NOT NULL DEFAULT false,
  appareil VARCHAR(20),
  navigateur VARCHAR(40),
  os VARCHAR(20),
  ip_anonyme VARCHAR(64)
);

CREATE INDEX IF NOT EXISTS connexion_utilisateur_utilisateur_date ON connexion_utilisateur (utilisateur_id, cree_le);
CREATE INDEX IF NOT EXISTS connexion_utilisateur_date ON connexion_utilisateur (cree_le);
