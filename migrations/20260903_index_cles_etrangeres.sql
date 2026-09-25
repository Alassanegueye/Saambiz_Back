-- =====================================================================
--  Migration SaamBiz — index sur les clés étrangères manquantes
--
--  `sequelize.sync()` ne crée pas d'index sur une table déjà existante :
--  déclarer `indexes:` dans le modèle ne suffit donc pas sur une base en
--  production. Ce fichier applique les mêmes index côté serveur.
--
--  Sans eux, chaque jointure fréquente — les produits d'une boutique, les
--  commandes d'un vendeur, les lignes d'une commande — force un parcours
--  séquentiel. Invisible sur un jeu de démonstration, coûteux dès quelques
--  milliers de lignes.
--
--  `IF NOT EXISTS` partout : rejouable sans risque.
-- =====================================================================

BEGIN;

-- Boutique d'un vendeur
CREATE INDEX IF NOT EXISTS idx_boutique_vendeur        ON boutique (vendeur_id);

-- Catalogue
CREATE INDEX IF NOT EXISTS idx_produit_categorie       ON produit (categorie_id);

-- Commandes et leurs lignes
CREATE INDEX IF NOT EXISTS idx_commande_vendeur        ON commande (vendeur_id);
CREATE INDEX IF NOT EXISTS idx_ligne_commande_produit  ON ligne_commande (produit_id);

-- Paiements rattachés à un abonnement ou à une commande
CREATE INDEX IF NOT EXISTS idx_paiement_abonnement     ON paiement (abonnement_id);
CREATE INDEX IF NOT EXISTS idx_paiement_commande       ON paiement (commande_id);

-- Messagerie : les deux extrémités d'une conversation.
-- Ces quatre tables ne déclarent pas `underscored` : leurs colonnes sont
-- restées en camelCase et doivent être citées entre guillemets, sinon
-- PostgreSQL les met en minuscules et ne les trouve pas.
CREATE INDEX IF NOT EXISTS idx_message_destinataire    ON message ("destinataireId");
CREATE INDEX IF NOT EXISTS idx_message_expediteur      ON message ("expediteurId");

-- Notifications par utilisateur
CREATE INDEX IF NOT EXISTS idx_notification_utilisateur ON notification ("utilisateurId");

-- Promotions d'un vendeur, éventuellement ciblées sur un produit
CREATE INDEX IF NOT EXISTS idx_promotion_vendeur       ON promotion ("vendeurId");
CREATE INDEX IF NOT EXISTS idx_promotion_produit       ON promotion ("produitId");

-- Signalements : qui signale, et quoi
CREATE INDEX IF NOT EXISTS idx_signalement_signaleur   ON signalement (signaleur_id);
CREATE INDEX IF NOT EXISTS idx_signalement_cible       ON signalement (cible_id);

-- Retours produits
CREATE INDEX IF NOT EXISTS idx_demande_retour_acheteur ON demande_retour (acheteur_id);

-- Codes à usage unique
CREATE INDEX IF NOT EXISTS idx_user_otp_utilisateur    ON user_otp ("utilisateurId");

-- Journal d'audit : recherche par cible
CREATE INDEX IF NOT EXISTS idx_audit_log_cible         ON audit_log (cible_id);

COMMIT;
