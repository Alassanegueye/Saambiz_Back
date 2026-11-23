-- =====================================================================
--  La rubrique Signalements revient dans le dashboard.
--
--  Elle avait été désactivée le 26 octobre (20261026_retrait_menus_
--  signalements.sql) faute d'écran pour la traiter : les signalements
--  envoyés depuis l'application continuaient d'arriver en base, et personne
--  ne pouvait les examiner. L'écran existe désormais, la rubrique reprend
--  donc sa place.
--
--  `MENUS` reste désactivée : elle n'a pas d'écran et n'en attend pas.
--
--  Les permissions déjà accordées sur SIGNALEMENTS n'avaient pas été
--  effacées — elles redeviennent effectives telles quelles.
--
--  Idempotent : peut être relancé sans risque.
-- =====================================================================

BEGIN;

-- `deletedAt` remis à NULL : la table est en suppression logique
-- (paranoid), et une ligne effacée resterait invisible malgré `isActive`.
UPDATE menus
   SET "isActive"  = true,
       path        = '/signalements',
       ordre       = 11,
       "deletedAt" = NULL
 WHERE code = 'SIGNALEMENTS';

-- Base où la rubrique n'a jamais existé (elle est alors créée par le seed,
-- mais celui-ci ne corrige pas une ligne déjà présente).
INSERT INTO menus (name, code, path, icon, "isActive", ordre, "createdAt", "updatedAt")
SELECT 'Signalements', 'SIGNALEMENTS', '/signalements', 'check', true, 11, now(), now()
 WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'SIGNALEMENTS');

COMMIT;
