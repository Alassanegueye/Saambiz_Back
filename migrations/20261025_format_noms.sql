-- =====================================================================
--  Migration SaamBiz — noms déjà enregistrés remis en forme
--
--  Désormais, le serveur écrit toujours :
--    prénom : majuscule à chaque mot (« Awa Fatou », « Jean-Pierre ») ;
--    nom de famille : tout en majuscules (« DIOP ») ;
--    nom de boutique : majuscule initiale (« Chez awa »).
--  Cette migration applique la même règle aux comptes existants.
--
--  Idempotent : peut être relancé sans risque.
-- =====================================================================

BEGIN;

UPDATE utilisateur
SET prenom = initcap(lower(regexp_replace(btrim(prenom), '\s+', ' ', 'g'))),
    nom    = upper(regexp_replace(btrim(nom), '\s+', ' ', 'g'))
WHERE prenom IS DISTINCT FROM initcap(lower(regexp_replace(btrim(prenom), '\s+', ' ', 'g')))
   OR nom    IS DISTINCT FROM upper(regexp_replace(btrim(nom), '\s+', ' ', 'g'));

UPDATE boutique
SET nom = upper(left(regexp_replace(btrim(nom), '\s+', ' ', 'g'), 1))
          || substr(regexp_replace(btrim(nom), '\s+', ' ', 'g'), 2)
WHERE nom IS DISTINCT FROM upper(left(regexp_replace(btrim(nom), '\s+', ' ', 'g'), 1))
          || substr(regexp_replace(btrim(nom), '\s+', ' ', 'g'), 2);

UPDATE commande
SET client_prenom = initcap(lower(regexp_replace(btrim(client_prenom), '\s+', ' ', 'g'))),
    client_nom    = upper(regexp_replace(btrim(client_nom), '\s+', ' ', 'g'))
WHERE client_prenom IS NOT NULL OR client_nom IS NOT NULL;

COMMIT;
