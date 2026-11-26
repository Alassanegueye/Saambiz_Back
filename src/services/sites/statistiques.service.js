// services/sites/statistiques.service.js
//
// La fréquentation d'un site vitrine, pour les dashboards : chiffres de la
// période, courbe, pages, origines, appareils, clics — et les visites une à
// une, page par page. Même contrat que l'ancienne API PHP du site Kodafrik
// (statistiques.php, visites.php) : le dashboard n'a pas à changer de lecture.
//
// Périodes : « jour » (aujourd'hui, heure par heure), « 7 », « 30 », « 90 »
// (jours, aujourd'hui compris). Dakar est à l'heure UTC toute l'année.

const sequelize = require('../../config/db');
const { texte } = require('./visiteur');

const JOURS = { jour: 0, 7: 6, 30: 29, 90: 89 };
const EN_LIGNE_MS = 5 * 60 * 1000;
const PAR_PAGE = [10, 20, 50, 100];

/** La période demandée, ou 7 jours. */
const lirePeriode = (p) => (Object.prototype.hasOwnProperty.call(JOURS, String(p)) ? String(p) : '7');

/** Début de la période, à minuit (UTC = Dakar). */
function debutPeriode(periode, maintenant = new Date()) {
  const n = JOURS[lirePeriode(periode)];
  return new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), maintenant.getUTCDate() - n));
}

/** « 2026-11-26T00:00:00Z » : la forme de l'ancienne API. */
const iso = (date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

const entier = (v) => Number(v) || 0;

/** Les visites de la période, et d'où chacune est arrivée (sa première page). */
const CTE_VISITES = `
  visites AS (
    SELECT visite,
           MIN(cree_le) AS debut,
           MAX(cree_le) AS fin,
           COUNT(*) FILTER (WHERE type = 'page') AS pages,
           COALESCE(SUM(valeur) FILTER (WHERE type = 'duree'), 0) AS duree_ms
      FROM site_evenement
     WHERE site = :site AND cree_le >= :du
     GROUP BY visite
  ),
  origines AS (
    SELECT DISTINCT ON (visite)
           visite, source, appareil, navigateur, os, pays, langue, ecran, ip_anonyme,
           chemin AS arrivee, referent, utm_campagne
      FROM site_evenement
     WHERE site = :site AND cree_le >= :du AND type = 'page'
     ORDER BY visite, cree_le, id
  )`;

/** Colonnes qu'on peut répartir (jamais un nom venu de la requête). */
const REPARTITIONS = {
  sources: 'source',
  appareils: 'appareil',
  navigateurs: 'navigateur',
  systemes: 'os',
  pays: 'pays',
  langues: 'langue',
  ecrans: 'ecran',
  arrivees: 'arrivee',
};

/** Un motif ILIKE sûr : les jokers de l'utilisateur sont pris à la lettre. */
const motif = (q) => `%${String(q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

class StatistiquesSiteService {
  static async _tous(sql, replacements) {
    return sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });
  }

  static async _un(sql, replacements) {
    const [ligne] = await StatistiquesSiteService._tous(sql, replacements);
    return ligne ? Object.values(ligne)[0] : null;
  }

  /** GET /admin/sites/:site/statistiques?periode= */
  static async statistiques(site, periodeDemandee, maintenant = new Date()) {
    const periode = lirePeriode(periodeDemandee);
    const du = debutPeriode(periode, maintenant);
    const p = { site, du };
    const t = StatistiquesSiteService._tous;
    const un = StatistiquesSiteService._un;

    const parHeure = periode === 'jour';
    const cle = parHeure ? "to_char(cree_le AT TIME ZONE 'UTC', 'HH24')" : "to_char(jour, 'YYYY-MM-DD')";

    const pagesDe = (filtre, limite) => t(
      `SELECT chemin, MAX(titre) AS titre, COUNT(*) AS vues, COUNT(DISTINCT visite) AS visites
         FROM site_evenement
        WHERE site = :site AND type = 'page' AND cree_le >= :du ${filtre}
        GROUP BY chemin ORDER BY vues DESC, chemin ${limite}`,
      p,
    );

    const [pagesVues, resume, visiteurs, enLigne, messages, serie, pages, realisations, articles, clics, ...repartitions] = await Promise.all([
      un("SELECT COUNT(*) AS n FROM site_evenement WHERE site = :site AND type = 'page' AND cree_le >= :du", p),
      t(`WITH ${CTE_VISITES}
         SELECT COUNT(*) AS visites, COUNT(*) FILTER (WHERE pages <= 1) AS rebonds, AVG(duree_ms) AS duree_moyenne
           FROM visites WHERE pages > 0`, p),
      un('SELECT COUNT(DISTINCT (visiteur, jour)) AS n FROM site_evenement WHERE site = :site AND cree_le >= :du', p),
      un('SELECT COUNT(DISTINCT visite) AS n FROM site_evenement WHERE site = :site AND cree_le >= :depuis',
        { site, depuis: new Date(maintenant.getTime() - EN_LIGNE_MS) }),
      un('SELECT COUNT(*) AS n FROM site_message WHERE site = :site AND cree_le >= :du', p),
      t(`SELECT ${cle} AS cle, COUNT(*) FILTER (WHERE type = 'page') AS pages,
                COUNT(DISTINCT visite) AS visites, COUNT(DISTINCT visiteur) AS visiteurs
           FROM site_evenement WHERE site = :site AND cree_le >= :du
          GROUP BY 1 ORDER BY 1`, p),
      pagesDe('', 'LIMIT 15'),
      pagesDe("AND chemin LIKE '/realisations/%'", ''),
      pagesDe("AND chemin LIKE '/blog/%'", ''),
      t(`SELECT cible AS nom, COUNT(*) AS nombre FROM site_evenement
          WHERE site = :site AND type = 'clic' AND cree_le >= :du
          GROUP BY cible ORDER BY nombre DESC`, p),
      ...Object.values(REPARTITIONS).map((colonne) => t(
        `WITH ${CTE_VISITES}
         SELECT COALESCE(o.${colonne}, 'Inconnu') AS nom, COUNT(*) AS visites
           FROM visites v JOIN origines o ON o.visite = v.visite
          GROUP BY 1 ORDER BY visites DESC, nom LIMIT 12`,
        p,
      )),
    ]);

    const r = resume[0] || {};
    const nbVisites = entier(r.visites);
    const vues = entier(pagesVues);
    const lignesPages = (lignes) => lignes.map((l) => ({ chemin: l.chemin, titre: l.titre, vues: entier(l.vues), visites: entier(l.visites) }));
    const parNom = (lignes) => lignes.map((l) => ({ nom: l.nom, visites: entier(l.visites) }));
    const listeRealisations = lignesPages(realisations);

    const reponse = {
      periode,
      du: iso(du),
      chiffres: {
        pages_vues: vues,
        visites: nbVisites,
        visiteurs: entier(visiteurs),
        duree_moyenne_ms: Math.round(Number(r.duree_moyenne) || 0),
        taux_rebond: nbVisites ? Math.round((1000 * entier(r.rebonds)) / nbVisites) / 10 : null,
        pages_par_visite: nbVisites ? Math.round((10 * vues) / nbVisites) / 10 : null,
        en_ligne: entier(enLigne),
        messages: entier(messages),
        vues_realisations: listeRealisations.reduce((s, l) => s + l.vues, 0),
      },
      serie: {
        par: parHeure ? 'heure' : 'jour',
        points: serie.map((l) => ({ cle: l.cle, pages: entier(l.pages), visites: entier(l.visites), visiteurs: entier(l.visiteurs) })),
      },
      pages: lignesPages(pages),
      realisations: listeRealisations,
      articles: lignesPages(articles),
      clics: clics.map((l) => ({ nom: l.nom, nombre: entier(l.nombre) })),
    };
    Object.keys(REPARTITIONS).forEach((nom, i) => { reponse[nom] = parNom(repartitions[i]); });
    return reponse;
  }

  /**
   * GET /admin/sites/:site/visites?periode=&page=&par=&source=&appareil=&pays=&ecrit=&q=
   * Les visites une à une, de la plus récente à la plus ancienne.
   */
  static async visites(site, requete = {}, maintenant = new Date()) {
    const du = debutPeriode(requete.periode, maintenant);
    const par = PAR_PAGE.includes(Number(requete.par)) ? Number(requete.par) : 20;
    const valeurs = { site, du };

    const conditions = [];
    for (const [param, colonne] of [['source', 'source'], ['appareil', 'appareil'], ['pays', 'pays']]) {
      const v = texte(requete[param], 80);
      if (v !== null) {
        conditions.push(`COALESCE(${colonne}, 'Inconnu') = :${param}`);
        valeurs[param] = v;
      }
    }
    if (['1', 'true', 'oui'].includes(String(requete.ecrit || ''))) conditions.push('messages > 0');
    const q = texte(requete.q, 100);
    if (q !== null) {
      conditions.push(`(visite IN (SELECT visite FROM site_evenement
                                    WHERE site = :site AND cree_le >= :du AND (chemin ILIKE :q OR titre ILIKE :q))
                       OR source ILIKE :q OR navigateur ILIKE :q OR os ILIKE :q OR ip_anonyme ILIKE :q OR langue ILIKE :q)`);
      valeurs.q = motif(q);
    }
    const ou = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const avecListe = `WITH ${CTE_VISITES},
      liste AS (
        SELECT v.visite, v.debut, v.fin, v.pages, v.duree_ms,
               o.source, o.appareil, o.navigateur, o.os, o.pays, o.langue, o.ecran, o.ip_anonyme,
               o.arrivee, o.referent, o.utm_campagne,
               (SELECT COUNT(*) FROM site_message m WHERE m.site = :site AND m.visite = v.visite) AS messages
          FROM visites v JOIN origines o ON o.visite = v.visite
      )`;

    const total = entier(await StatistiquesSiteService._un(`${avecListe} SELECT COUNT(*) AS n FROM liste ${ou}`, valeurs));
    const pages = Math.max(1, Math.ceil(total / par));
    const page = Math.min(Math.max(1, parseInt(requete.page, 10) || 1), pages);

    const lignes = await StatistiquesSiteService._tous(
      `${avecListe} SELECT * FROM liste ${ou} ORDER BY fin DESC LIMIT :par OFFSET :decalage`,
      { ...valeurs, par, decalage: (page - 1) * par },
    );

    // Le parcours de chaque visite (60 pages ou clics au plus), en une requête.
    const numeros = lignes.map((l) => l.visite);
    const parcours = numeros.length
      ? await StatistiquesSiteService._tous(
        `SELECT visite, date, type, chemin, titre, cible FROM (
           SELECT visite, cree_le AS date, type, chemin, titre, cible,
                  ROW_NUMBER() OVER (PARTITION BY visite ORDER BY cree_le, id) AS rang
             FROM site_evenement
            WHERE site = :site AND visite IN (:numeros) AND type IN ('page', 'clic')
         ) p WHERE rang <= 60 ORDER BY date`,
        { site, numeros },
      )
      : [];
    const parVisite = new Map();
    for (const e of parcours) {
      if (!parVisite.has(e.visite)) parVisite.set(e.visite, []);
      parVisite.get(e.visite).push({ date: e.date, type: e.type, chemin: e.chemin, titre: e.titre, cible: e.cible });
    }

    const limiteEnLigne = maintenant.getTime() - EN_LIGNE_MS;
    const visites = lignes.map(({ visite, ...l }) => ({
      ...l,
      pages: entier(l.pages),
      duree_ms: entier(l.duree_ms),
      messages: entier(l.messages),
      parcours: parVisite.get(visite) || [],
      en_ligne: new Date(l.fin).getTime() > limiteEnLigne,
    }));

    const options = async (colonne) => (await StatistiquesSiteService._tous(
      `${avecListe} SELECT COALESCE(${colonne}, 'Inconnu') AS nom, COUNT(*) AS n FROM liste GROUP BY 1 ORDER BY n DESC, nom LIMIT 40`,
      { site, du },
    )).map((l) => ({ nom: l.nom, visites: entier(l.n) }));
    const [sources, appareils, pays] = await Promise.all([options('source'), options('appareil'), options('pays')]);

    return { visites, total, page, pages, par, filtres: { sources, appareils, pays } };
  }
}

StatistiquesSiteService.debutPeriode = debutPeriode;
StatistiquesSiteService.lirePeriode = lirePeriode;
module.exports = StatistiquesSiteService;
