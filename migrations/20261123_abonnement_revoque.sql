-- Un abonnement retiré par un administrateur n'est pas un abonnement arrivé à
-- son terme. Les deux cas posaient pourtant `expire`, et le back-office ne
-- pouvait plus dire lequel s'était produit — ni pourquoi l'accès d'un vendeur
-- avait été coupé.
--
-- `IF NOT EXISTS` : la migration est rejouable, et `sequelize.sync()` peut
-- avoir créé le type avant elle sur une base neuve.
ALTER TYPE enum_abonnement_statut ADD VALUE IF NOT EXISTS 'revoque';

-- Les abonnements déjà révoqués ne sont pas rattrapables : rien ne les
-- distingue en base des abonnements expirés. Ils restent donc `expire`, et la
-- distinction ne vaut que pour les révocations à venir.
