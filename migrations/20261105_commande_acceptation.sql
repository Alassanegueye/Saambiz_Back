-- Le vendeur accepte ou rejette une commande avant tout paiement ; le client
-- ne paie qu'une commande acceptée. Trois étapes de plus dans son parcours.
ALTER TYPE enum_commande_statut ADD VALUE IF NOT EXISTS 'acceptee';
ALTER TYPE enum_commande_statut ADD VALUE IF NOT EXISTS 'rejetee';
ALTER TYPE enum_commande_statut ADD VALUE IF NOT EXISTS 'payee';

-- Les notifications de commande échouaient en silence : ce type manquait, et
-- l'erreur était avalée par l'envoi « au mieux ». Aucun vendeur ni client n'en
-- recevait, ni dans l'application ni en push.
ALTER TYPE enum_notification_type ADD VALUE IF NOT EXISTS 'commande';
