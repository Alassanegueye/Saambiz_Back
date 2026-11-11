-- Centre d'aide de l'application : questions fréquentes et coordonnées du
-- service client, modifiables depuis le dashboard admin.
CREATE TABLE IF NOT EXISTS question_frequente (
  id UUID PRIMARY KEY,
  question TEXT NOT NULL,
  reponse TEXT NOT NULL,
  ordre INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Au démarrage, sequelize.sync() a pu créer la table AVANT cette migration,
-- d'après le modèle : ses colonnes de dates n'ont alors aucune valeur par
-- défaut et le CREATE ci-dessus n'y change rien. On les pose ici.
ALTER TABLE question_frequente ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE question_frequente ALTER COLUMN updated_at SET DEFAULT now();

-- Les questions affichées jusqu'ici dans l'application, reprises une seule
-- fois (table vide) pour que l'admin parte de l'existant. Les dates sont
-- écrites explicitement : la migration ne dépend d'aucune valeur par défaut.
INSERT INTO question_frequente (id, question, reponse, ordre, active, created_at, updated_at)
SELECT gen_random_uuid(), q.question, q.reponse, q.ordre, true, now(), now()
  FROM (VALUES
    (1, 'SaamBiz est-il gratuit ?', 'Oui. Ouvrir une boutique, publier des produits et recevoir des commandes ne coûte rien, et SaamBiz ne prélève aucune commission sur vos ventes.'),
    (2, 'Comment créer ma boutique ?', 'Créez un compte vendeur depuis l''écran de connexion (« Créer un compte », puis « Vendeur »), confirmez votre e-mail avec le code reçu, puis renseignez le nom, le logo et les catégories de votre boutique.'),
    (3, 'Où trouver le lien de ma boutique ?', 'Dans l''onglet Boutique. Votre boutique a sa propre adresse, saambiz.com/b/votre-boutique : partagez-la sur WhatsApp ou Instagram, vos clients commandent sans installer l''application.'),
    (4, 'Je n''ai pas reçu le code de confirmation', 'Vérifiez vos courriers indésirables, puis touchez « Renvoyer le code » sur l''écran de vérification. Le code est valable quelques minutes.'),
    (5, 'Quels moyens de paiement sont acceptés ?', 'Orange Money et Wave pour le paiement en ligne, ou le paiement à la livraison. Free Money et les cartes bancaires ne sont pas encore acceptés.'),
    (6, 'Comment suivre une commande ?', 'Ouvrez l''onglet Commandes : chaque commande indique son statut (en attente, confirmée, expédiée, livrée) et se met à jour en temps réel.'),
    (7, 'Comment supprimer mon compte ?', 'Compte, puis Sécurité, puis Supprimer mon compte.')
  ) AS q(ordre, question, reponse)
 WHERE NOT EXISTS (SELECT 1 FROM question_frequente);

-- Coordonnées du service client (clés de config_app).
INSERT INTO config_app (id, cle, valeur, description, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'contact_whatsapp', '+221775929390', 'WhatsApp du service client (centre d''aide)', now(), now()),
  (gen_random_uuid(), 'contact_email', 'contact@saambiz.com', 'E-mail du service client (centre d''aide)', now(), now()),
  (gen_random_uuid(), 'contact_telephone', '+221775929390', 'Téléphone du service client (centre d''aide)', now(), now())
ON CONFLICT (cle) DO NOTHING;
