// services/sites/vendeurs.service.js
//
// La page « Site vitrine » de l'administration SaamBiz :
//
//   GET /admin/sites/saambiz/boutiques?periode=        visites des boutiques
//   GET /admin/sites/saambiz/vendeurs?periode=&filtre=&q=&page=&par=
//                                                       vendeurs authentifiés
//   GET /admin/sites/saambiz/vendeurs/:id/activites?periode=
//                                                       ce qu'un vendeur a fait
//
// Les visites viennent de `visite_boutique` (une par visiteur, par boutique
// et par jour, sur le site comme dans l'application). L'activité d'un vendeur
// se lit là où elle laisse une trace : ses connexions, ses sessions (chaque
// reprise de session de l'application ou du dashboard), ses produits, ses
// commandes traitées, ses promotions, ses messages aux clients — jamais leur
// contenu.

const sequelize = require('../../config/db');
const { NotFoundError } = require('../../errors/AppError');
const { debutPeriode, lirePeriode } = require('./statistiques.service');
const { texte, lireAgent, estApplication } = require('./visiteur');

const tous = (sql, replacements) => sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });
const entier = (v) => Number(v) || 0;
const jourIso = (d) => d.toISOString().slice(0, 10);
const motif = (q) => `%${String(q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const PAR_PAGE = [10, 20, 50, 100];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** « Application » ou « Chrome · Android » : d'où vient une session. */
function appareilDe(userAgent) {
  if (!userAgent) return null;
  if (estApplication(userAgent)) return 'Application';
  const { navigateur, os } = lireAgent(userAgent);
  return `${navigateur} · ${os}`;
}

const STATUTS_COMMANDE = {
  en_attente: 'en attente',
  acceptee: 'acceptée',
  confirmee: 'confirmée',
  en_preparation: 'en préparation',
  prete: 'prête',
  expediee: 'expédiée',
  en_livraison: 'en livraison',
  livree: 'livrée',
  annulee: 'annulée',
  refusee: 'refusée',
  retournee: 'retournée',
};
const statutLisible = (s) => STATUTS_COMMANDE[s] || String(s || '').replace(/_/g, ' ');

/** Ce que dit une ligne de l'historique d'une commande. */
function operationLisible(operation, statutApres) {
  switch (operation) {
    case 'creation': return 'a enregistré la commande';
    case 'statut': return `a passé la commande en « ${statutLisible(statutApres)} »`;
    case 'paiement': return 'a mis à jour le paiement';
    case 'annulation': return 'a annulé la commande';
    case 'demande_annulation': return "a demandé l'annulation";
    case 'reponse_annulation': return "a répondu à une demande d'annulation";
    default: return String(operation || 'a modifié la commande').replace(/_/g, ' ');
  }
}

class VendeursSiteService {
  /** Les visites des boutiques sur la période : totaux, courbe, boutiques les plus vues. */
  static async boutiques(periodeDemandee, maintenant = new Date()) {
    const periode = lirePeriode(periodeDemandee);
    const du = debutPeriode(periode, maintenant);
    const p = { du, jourDebut: jourIso(du) };
    const parHeure = periode === 'jour';
    const cle = parHeure ? "to_char(created_at AT TIME ZONE 'UTC', 'HH24')" : "to_char(jour, 'YYYY-MM-DD')";

    const [[totaux = {}], serie, top, [vendeurs = {}]] = await Promise.all([
      tous(`SELECT COUNT(*) AS visites,
                   COUNT(*) FILTER (WHERE canal = 'site') AS site,
                   COUNT(*) FILTER (WHERE canal = 'app') AS app,
                   COUNT(DISTINCT boutique_id) AS boutiques
              FROM visite_boutique WHERE jour >= :jourDebut`, p),
      tous(`SELECT ${cle} AS cle,
                   COUNT(*) FILTER (WHERE canal = 'site') AS site,
                   COUNT(*) FILTER (WHERE canal = 'app') AS app
              FROM visite_boutique WHERE jour >= :jourDebut
             GROUP BY 1 ORDER BY 1`, p),
      tous(`SELECT b.id, b.nom, b.slug, b.vitrine_active,
                   COUNT(*) AS visites,
                   COUNT(*) FILTER (WHERE v.canal = 'site') AS site,
                   COUNT(*) FILTER (WHERE v.canal = 'app') AS app
              FROM visite_boutique v JOIN boutique b ON b.id = v.boutique_id
             WHERE v.jour >= :jourDebut
             GROUP BY b.id, b.nom, b.slug, b.vitrine_active
             ORDER BY visites DESC, b.nom LIMIT 10`, p),
      tous(`SELECT COUNT(*) AS inscrits,
                   COUNT(*) FILTER (WHERE u.created_at >= :du) AS nouveaux,
                   COUNT(*) FILTER (WHERE GREATEST(u.derniere_connexion, s.derniere) >= :du) AS actifs
              FROM utilisateur u
              LEFT JOIN (SELECT utilisateur_id, MAX(created_at) AS derniere FROM refresh_token GROUP BY utilisateur_id) s
                ON s.utilisateur_id = u.id
             WHERE u.role = 'Vendeur' AND u.deleted_at IS NULL`, p),
    ]);

    return {
      periode,
      du: du.toISOString(),
      chiffres: {
        visites: entier(totaux.visites),
        visites_site: entier(totaux.site),
        visites_app: entier(totaux.app),
        boutiques_visitees: entier(totaux.boutiques),
        vendeurs_inscrits: entier(vendeurs.inscrits),
        vendeurs_actifs: entier(vendeurs.actifs),
        nouveaux_vendeurs: entier(vendeurs.nouveaux),
      },
      serie: {
        par: parHeure ? 'heure' : 'jour',
        points: serie.map((l) => ({ cle: l.cle, site: entier(l.site), app: entier(l.app) })),
      },
      boutiques: top.map((l) => ({
        id: l.id, nom: l.nom, slug: l.slug, vitrine_active: Boolean(l.vitrine_active),
        visites: entier(l.visites), site: entier(l.site), app: entier(l.app),
      })),
    };
  }

  /**
   * Les vendeurs et leurs connexions : première et dernière connexion,
   * dernière activité (connexion ou reprise de session), appareil, et ce
   * qu'ils ont fait sur la période. `filtre` : « actifs » (par défaut, venus
   * sur la période) ou « tous ».
   */
  static async vendeurs(requete = {}, maintenant = new Date()) {
    const periode = lirePeriode(requete.periode);
    const du = debutPeriode(periode, maintenant);
    const par = PAR_PAGE.includes(Number(requete.par)) ? Number(requete.par) : 20;
    const valeurs = { du, jourDebut: jourIso(du) };

    const conditions = [];
    if (requete.filtre !== 'tous') conditions.push('derniere_activite >= :du');
    const q = texte(requete.q, 100);
    if (q) {
      conditions.push('(nom ILIKE :q OR prenom ILIKE :q OR email ILIKE :q OR telephone ILIKE :q OR boutique ILIKE :q)');
      valeurs.q = motif(q);
    }
    const ou = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const base = `WITH sessions AS (
        SELECT utilisateur_id, MAX(created_at) AS derniere,
               (ARRAY_AGG(user_agent ORDER BY created_at DESC))[1] AS agent,
               COUNT(DISTINCT (created_at AT TIME ZONE 'UTC')::date) FILTER (WHERE created_at >= :du) AS jours_actifs
          FROM refresh_token GROUP BY utilisateur_id
      ),
      liste AS (
        SELECT u.id, u.nom, u.prenom, u.email, u.telephone, u.statut, u.created_at AS inscrit_le,
               u.premiere_connexion, u.derniere_connexion,
               b.id AS boutique_id, b.nom AS boutique, b.slug, b.vitrine_active,
               s.agent, COALESCE(s.jours_actifs, 0) AS jours_actifs,
               GREATEST(u.derniere_connexion, s.derniere) AS derniere_activite
          FROM utilisateur u
          LEFT JOIN LATERAL (
            SELECT id, nom, slug, vitrine_active FROM boutique
             WHERE vendeur_id = u.id AND deleted_at IS NULL ORDER BY created_at LIMIT 1
          ) b ON true
          LEFT JOIN sessions s ON s.utilisateur_id = u.id
         WHERE u.role = 'Vendeur' AND u.deleted_at IS NULL
      )`;

    const [{ n: total } = { n: 0 }] = await tous(`${base} SELECT COUNT(*) AS n FROM liste ${ou}`, valeurs);
    const pages = Math.max(1, Math.ceil(entier(total) / par));
    const page = Math.min(Math.max(1, parseInt(requete.page, 10) || 1), pages);

    const lignes = await tous(
      `${base}
       SELECT * FROM liste ${ou}
        ORDER BY derniere_activite DESC NULLS LAST, inscrit_le DESC
        LIMIT :par OFFSET :decalage`,
      { ...valeurs, par, decalage: (page - 1) * par },
    );

    // Ce que chacun a fait sur la période, en une requête par trace.
    const ids = lignes.map((l) => l.id);
    const compte = async (sql) => {
      if (!ids.length) return new Map();
      const r = await tous(sql, { ...valeurs, ids });
      return new Map(r.map((l) => [l.id, entier(l.n)]));
    };
    const [connexions, produits, commandes, promotions, messages, visites] = await Promise.all([
      compte('SELECT utilisateur_id AS id, COUNT(*) AS n FROM connexion_utilisateur WHERE utilisateur_id IN (:ids) AND cree_le >= :du GROUP BY 1'),
      compte('SELECT vendeur_id AS id, COUNT(*) AS n FROM produit WHERE vendeur_id IN (:ids) AND created_at >= :du GROUP BY 1'),
      compte("SELECT auteur_id AS id, COUNT(*) AS n FROM historique_commande WHERE auteur_id IN (:ids) AND auteur_role = 'vendeur' AND created_at >= :du GROUP BY 1"),
      compte('SELECT "vendeurId" AS id, COUNT(*) AS n FROM promotion WHERE "vendeurId" IN (:ids) AND "createdAt" >= :du GROUP BY 1'),
      compte('SELECT "expediteurId" AS id, COUNT(*) AS n FROM message WHERE "expediteurId" IN (:ids) AND "createdAt" >= :du GROUP BY 1'),
      compte('SELECT b.vendeur_id AS id, COUNT(*) AS n FROM visite_boutique v JOIN boutique b ON b.id = v.boutique_id WHERE b.vendeur_id IN (:ids) AND v.jour >= :jourDebut GROUP BY 1'),
    ]);

    const vendeurs = lignes.map(({ agent, ...l }) => ({
      ...l,
      vitrine_active: Boolean(l.vitrine_active),
      jours_actifs: entier(l.jours_actifs),
      appareil: appareilDe(agent),
      activite: {
        connexions: connexions.get(l.id) || 0,
        produits: produits.get(l.id) || 0,
        commandes: commandes.get(l.id) || 0,
        promotions: promotions.get(l.id) || 0,
        messages: messages.get(l.id) || 0,
        visites_boutique: visites.get(l.id) || 0,
      },
    }));

    return { periode, du: du.toISOString(), vendeurs, total: entier(total), page, pages, par };
  }

  /** Le fil d'activité d'un vendeur sur la période, du plus récent au plus ancien. */
  static async activites(vendeurId, periodeDemandee, maintenant = new Date()) {
    if (!UUID.test(String(vendeurId || ''))) throw new NotFoundError('Vendeur introuvable.');
    const periode = lirePeriode(periodeDemandee);
    const du = debutPeriode(periode, maintenant);
    const [vendeur] = await tous(
      `SELECT u.id, u.nom, u.prenom, u.email, u.telephone, u.statut, u.created_at AS inscrit_le,
              u.premiere_connexion, u.derniere_connexion,
              b.nom AS boutique, b.slug, b.vitrine_active, b.vitrine_creee_le
         FROM utilisateur u
         LEFT JOIN LATERAL (
           SELECT nom, slug, vitrine_active, vitrine_creee_le FROM boutique
            WHERE vendeur_id = u.id AND deleted_at IS NULL ORDER BY created_at LIMIT 1
         ) b ON true
        WHERE u.id = :id AND u.role = 'Vendeur' AND u.deleted_at IS NULL`,
      { id: vendeurId },
    );
    if (!vendeur) throw new NotFoundError('Vendeur introuvable.');

    const p = { id: vendeurId, du };
    const [connexions, sessions, produits, commandes, promotions, messages] = await Promise.all([
      tous('SELECT cree_le AS date, application, appareil, navigateur, os FROM connexion_utilisateur WHERE utilisateur_id = :id AND cree_le >= :du', p),
      // Les reprises de session, regroupées par jour : l'application et le
      // dashboard renouvellent leur session toutes les heures d'utilisation.
      tous(`SELECT (created_at AT TIME ZONE 'UTC')::date AS jour, MAX(created_at) AS date, COUNT(*) AS n,
                   (ARRAY_AGG(user_agent ORDER BY created_at DESC))[1] AS agent
              FROM refresh_token WHERE utilisateur_id = :id AND created_at >= :du
             GROUP BY 1`, p),
      tous('SELECT created_at AS date, nom FROM produit WHERE vendeur_id = :id AND created_at >= :du', p),
      tous(`SELECT h.created_at AS date, h.operation, h.statut_apres, c.reference_commande AS reference
              FROM historique_commande h LEFT JOIN commande c ON c.id = h.commande_id
             WHERE h.auteur_id = :id AND h.auteur_role = 'vendeur' AND h.created_at >= :du`, p),
      tous('SELECT "createdAt" AS date, titre FROM promotion WHERE "vendeurId" = :id AND "createdAt" >= :du', p),
      tous(`SELECT ("createdAt" AT TIME ZONE 'UTC')::date AS jour, MAX("createdAt") AS date, COUNT(*) AS n
              FROM message WHERE "expediteurId" = :id AND "createdAt" >= :du GROUP BY 1`, p),
    ]);

    const evenements = [
      ...connexions.map((c) => ({
        date: c.date,
        type: 'connexion',
        titre: 'Connexion',
        detail: c.application ? 'Application mobile' : [c.navigateur, c.os].filter(Boolean).join(' · ') || null,
      })),
      ...sessions.map((s) => ({
        date: s.date,
        type: 'session',
        titre: 'Actif ce jour-là',
        detail: [appareilDe(s.agent), `${entier(s.n)} reprise${entier(s.n) > 1 ? 's' : ''} de session`].filter(Boolean).join(' · '),
      })),
      ...produits.map((x) => ({ date: x.date, type: 'produit', titre: 'Produit ajouté', detail: x.nom })),
      ...commandes.map((x) => ({
        date: x.date,
        type: 'commande',
        titre: x.reference ? `Commande ${x.reference}` : 'Commande',
        detail: operationLisible(x.operation, x.statut_apres),
      })),
      ...promotions.map((x) => ({ date: x.date, type: 'promotion', titre: 'Promotion créée', detail: x.titre })),
      ...messages.map((x) => ({
        date: x.date,
        type: 'message',
        titre: 'Messages aux clients',
        detail: `${entier(x.n)} message${entier(x.n) > 1 ? 's' : ''} envoyé${entier(x.n) > 1 ? 's' : ''}`,
      })),
    ];
    if (vendeur.vitrine_creee_le && new Date(vendeur.vitrine_creee_le) >= du) {
      evenements.push({ date: vendeur.vitrine_creee_le, type: 'boutique', titre: 'Site de la boutique créé', detail: vendeur.slug ? `saambiz.com/b/${vendeur.slug}` : null });
    }
    evenements.sort((a, b) => new Date(b.date) - new Date(a.date));

    const { vitrine_creee_le: _ignore, ...profil } = vendeur;
    return {
      periode,
      du: du.toISOString(),
      vendeur: { ...profil, vitrine_active: Boolean(profil.vitrine_active) },
      evenements: evenements.slice(0, 400),
    };
  }
}

VendeursSiteService.appareilDe = appareilDe;
module.exports = VendeursSiteService;
