const {
  Produit, Categorie, Boutique, Utilisateur, ProduitImage, Commande, LigneCommande,
} = require('../../models');
const { Op } = require('sequelize');
const sequelize = require('../../config/db');
const VendeurService = require('../vendeurs/vendeur.service');
const CommandeService = require('../commandes/commande.service');
const { BadRequestError, ConflictError, NotFoundError } = require('../../errors/AppError');
const echecIgnore = require('../../utils/echecIgnore');
const { paginate } = require('../../utils/paginate');

/**
 * Produits et commandes gérés depuis le dashboard admin.
 *
 * Un produit et une commande appartiennent toujours à une boutique. En base,
 * le lien passe par le vendeur propriétaire de la boutique (`vendeurId`) :
 * l'admin choisit une boutique, le service en déduit le vendeur. Les règles
 * métier (catégorie active, stock, prix soldé, transitions) restent celles
 * des services vendeur et commande, réutilisés tels quels.
 */

const VENDEUR_AVEC_BOUTIQUE = {
  model: Utilisateur,
  as: 'vendeur',
  attributes: ['id', 'nom', 'prenom', 'telephone', 'email'],
  include: [{ model: Boutique, as: 'boutiques', attributes: ['id', 'nom', 'slug'] }],
};

/** Première boutique du vendeur, à plat, pour l'affichage. */
const aplatir = (instance) => {
  if (!instance) return instance;
  const o = instance.toJSON ? instance.toJSON() : instance;
  const b = o.vendeur?.boutiques?.[0] || null;
  return { ...o, boutique: b ? { id: b.id, nom: b.nom, slug: b.slug } : null };
};

const STATUTS_COMMANDE = ['en_attente', 'acceptee', 'rejetee', 'payee', 'confirmee', 'en_preparation', 'prete', 'en_livraison', 'livree', 'annulee'];
// Statuts où la marchandise est engagée : le stock doit être réservé.
const STATUTS_ENGAGES = ['acceptee', 'payee', 'confirmee', 'en_preparation', 'prete', 'en_livraison', 'livree'];

class AdminCatalogueService {

  // -------------------- BOUTIQUES --------------------

  /** Boutiques pour les listes déroulantes, avec leur vendeur. */
  static async optionsBoutiques() {
    const boutiques = await Boutique.findAll({
      attributes: ['id', 'nom', 'slug', 'vendeurId'],
      include: [{ model: Utilisateur, as: 'vendeur', attributes: ['id', 'nom', 'prenom', 'statut'] }],
      order: [['nom', 'ASC']],
    });
    return { boutiques };
  }

  static async _boutique(boutiqueId) {
    if (!boutiqueId) throw new BadRequestError('Choisissez la boutique');
    const boutique = await Boutique.findByPk(boutiqueId, { attributes: ['id', 'nom', 'vendeurId'] });
    if (!boutique) throw new NotFoundError('Boutique introuvable');
    return boutique;
  }

  static async _vendeurIdDeBoutique(boutiqueId) {
    if (!boutiqueId) return null;
    return (await AdminCatalogueService._boutique(boutiqueId)).vendeurId;
  }

  // -------------------- PRODUITS --------------------

  /** Clause d'un filtre de disponibilité. */
  static _filtreDisponibilite(statut) {
    if (statut === 'disponibles') return { disponible: true, quantite: { [Op.gt]: 0 } };
    if (statut === 'indisponibles') return { [Op.or]: [{ disponible: false }, { quantite: { [Op.lte]: 0 } }] };
    return {};
  }

  /**
   * Combien de produits dans chaque état, pour les pastilles de filtre.
   * Comptés sur toute la table : sur la page affichée, ils auraient annoncé
   * « 10 en vente » quel que soit le catalogue.
   */
  static async _compteursProduits(base) {
    const compter = (extra) => Produit.count({ where: { ...base, ...extra } });
    const [tous, disponibles, indisponibles] = await Promise.all([
      compter({}),
      compter(AdminCatalogueService._filtreDisponibilite('disponibles')),
      compter(AdminCatalogueService._filtreDisponibilite('indisponibles')),
    ]);
    return { '': tous, disponibles, indisponibles };
  }

  /**
   * Catalogue de toutes les boutiques.
   *
   * Paginé à la demande : sans `page` ni `limit`, la liste entière est
   * renvoyée comme avant — c'est ce dont le formulaire de commande a besoin
   * pour proposer les produits d'une boutique.
   */
  static async listerProduits({ boutiqueId, statut, recherche, page, limit } = {}) {
    const base = {};
    if (boutiqueId) base.vendeurId = await AdminCatalogueService._vendeurIdDeBoutique(boutiqueId);

    const where = { ...base, ...AdminCatalogueService._filtreDisponibilite(statut) };

    // La recherche porte sur le produit et sur sa boutique : c'est ainsi
    // qu'un administrateur cherche — « le savon de chez Awa ».
    const terme = String(recherche || '').trim();
    if (terme) {
      const motif = `%${terme.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where[Op.and] = [{
        [Op.or]: [
          { nom: { [Op.iLike]: motif } },
          { marque: { [Op.iLike]: motif } },
          { '$categorie.nom$': { [Op.iLike]: motif } },
          { '$vendeur.nom$': { [Op.iLike]: motif } },
          { '$vendeur.prenom$': { [Op.iLike]: motif } },
        ],
      }];
    }

    const include = [VENDEUR_AVEC_BOUTIQUE, { model: Categorie, as: 'categorie', attributes: ['id', 'nom'] }];
    const compteurs = await AdminCatalogueService._compteursProduits(base);

    if (page === undefined && limit === undefined) {
      const produits = await Produit.findAll({
        where, include, order: [['createdAt', 'DESC']], subQuery: false,
      });
      return { produits: produits.map(aplatir), compteurs };
    }

    const p = paginate(page, limit);
    const { rows, count } = await Produit.findAndCountAll({
      where, include,
      order: [['createdAt', 'DESC']],
      limit: p.limit,
      offset: p.offset,
      subQuery: false,
      distinct: true,
    });
    return {
      produits: rows.map(aplatir),
      total: count,
      page: p.page,
      pages: Math.ceil(count / p.limit),
      compteurs,
    };
  }

  static async detailProduit(id) {
    const produit = await Produit.findByPk(id, {
      include: [
        VENDEUR_AVEC_BOUTIQUE,
        { model: Categorie, as: 'categorie', attributes: ['id', 'nom'] },
        { model: ProduitImage, as: 'images', attributes: ['id', 'url', 'ordre'] },
      ],
    });
    if (!produit) throw new NotFoundError('Produit introuvable');
    return { produit: aplatir(produit) };
  }

  static async creerProduit({ boutiqueId, ...donnees }) {
    const boutique = await AdminCatalogueService._boutique(boutiqueId);
    if (!donnees.nom || !String(donnees.nom).trim()) throw new BadRequestError('Le nom est obligatoire');
    if (donnees.prix === undefined || donnees.prix === '' || Number(donnees.prix) < 0) {
      throw new BadRequestError('Prix invalide');
    }
    const produit = await VendeurService.ajouterProduit(boutique.vendeurId, {
      ...donnees,
      quantite: donnees.quantite === undefined || donnees.quantite === '' ? 0 : donnees.quantite,
      nomVendeur: boutique.nom,
    });
    return AdminCatalogueService.detailProduit(produit.id);
  }

  static async modifierProduit(id, { boutiqueId, ...donnees }) {
    const produit = await Produit.findByPk(id, { attributes: ['id', 'vendeurId'] });
    if (!produit) throw new NotFoundError('Produit introuvable');

    // Les champs vides d'un formulaire ne doivent pas effacer une valeur.
    if (donnees.prix_promo === '') donnees.prix_promo = null;
    await VendeurService.modifierProduit(produit.vendeurId, id, donnees);

    // Changement de boutique : le produit suit le vendeur de la nouvelle boutique.
    if (boutiqueId) {
      const vendeurId = await AdminCatalogueService._vendeurIdDeBoutique(boutiqueId);
      if (vendeurId !== produit.vendeurId) await Produit.update({ vendeurId }, { where: { id } });
    }
    return AdminCatalogueService.detailProduit(id);
  }

  // -------------------- COMMANDES --------------------

  static async detailCommande(id) {
    const commande = await Commande.findByPk(id, {
      include: [
        { model: LigneCommande, as: 'lignes' },
        { model: Utilisateur, as: 'acheteur', attributes: ['id', 'nom', 'prenom', 'telephone', 'email', 'adresse'] },
        VENDEUR_AVEC_BOUTIQUE,
      ],
    });
    if (!commande) throw new NotFoundError('Commande introuvable');
    return { commande: aplatir(commande) };
  }

  /**
   * Commande saisie par l'admin pour une boutique (commande par téléphone,
   * en boutique…). Client : un compte existant (`acheteurId`) ou des
   * coordonnées libres (`client`).
   */
  static async creerCommande({
    boutiqueId, acheteurId = null, client = null, items,
    modeLivraison, modePaiement, adresseLivraison, numeroTelephone, note,
  }) {
    const boutique = await AdminCatalogueService._boutique(boutiqueId);
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestError('Ajoutez au moins un produit');
    }

    const produits = await Produit.findAll({
      where: { id: items.map((i) => i.produitId).filter(Boolean) },
      attributes: ['id', 'nom', 'vendeurId'],
    });
    const etrangers = produits.filter((p) => p.vendeurId !== boutique.vendeurId);
    if (etrangers.length) {
      throw new BadRequestError(`« ${etrangers[0].nom} » n'appartient pas à la boutique ${boutique.nom}`);
    }

    if (acheteurId) {
      const acheteur = await Utilisateur.findOne({ where: { id: acheteurId, role: 'Acheteur' }, attributes: ['id'] });
      if (!acheteur) throw new NotFoundError('Client introuvable');
    } else if (!client?.nom || !client?.telephone) {
      throw new BadRequestError('Indiquez un client existant, ou le nom et le téléphone du client');
    }

    const commande = await CommandeService.creerCommande({
      acheteurId: acheteurId || null,
      client: acheteurId ? null : client,
      items,
      modeLivraison: modeLivraison || 'livraison',
      modePaiement: modePaiement || 'a_la_livraison',
      adresseLivraison: adresseLivraison || null,
      numeroTelephone: numeroTelephone || client?.telephone || null,
      note: note || null,
      origine: 'admin',
    });
    return AdminCatalogueService.detailCommande(commande.id);
  }

  /** Statut, paiement et coordonnées. Les lignes ne changent pas après coup. */
  /**
   * L'administration corrige une commande — SANS SORTIR DU WORKFLOW.
   *
   * Elle suit la MÊME table des transitions que le vendeur : une commande
   * que personne n'a préparée ni expédiée ne passe pas d'un trait de
   * `en_attente` à `livree`.
   *
   * Le statut de paiement ne se modifie pas par cette route : un
   * administrateur pourrait sinon déclarer « payé » sans le moindre
   * encaissement, ou « remboursé » sans remboursement. Un encaissement se
   * constate, par la passerelle ou par le vendeur qui confirme avoir reçu
   * l'argent.
   */
  static async modifierCommande(id, donnees, adminId = null) {
    const commande = await Commande.findByPk(id);
    if (!commande) throw new NotFoundError('Commande introuvable');

    const { statut, statutPaiement } = donnees;
    if (statut && !STATUTS_COMMANDE.includes(statut)) throw new BadRequestError('Statut inconnu');
    if (statutPaiement && statutPaiement !== commande.statutPaiement) {
      throw new BadRequestError(
        'Le statut de paiement ne se modifie pas à la main : il suit l\'encaissement réel '
        + '(passerelle de paiement, ou confirmation du vendeur pour un règlement à la réception).'
      );
    }
    if (commande.statut === 'annulee' && statut && statut !== 'annulee') {
      throw new BadRequestError('Une commande annulée ne peut pas être relancée : créez-en une nouvelle');
    }

    // Annulation : stock restauré, acheteur prévenu. Une commande payée est
    // refusée par `_annuler` lui-même, comme pour tout le monde.
    if (statut === 'annulee' && commande.statut !== 'annulee') {
      await CommandeService._annuler(commande, 'admin', 'annulee', {
        auteurId: adminId,
        motif: donnees.motif,
      });
      return AdminCatalogueService.detailCommande(id);
    }

    // La transition demandée doit exister dans le workflow, exactement comme
    // pour le vendeur.
    if (statut && statut !== commande.statut
        && !CommandeService.transitionPermise(commande.statut, statut)) {
      const possibles = CommandeService.transitionsDepuis(commande.statut)
        .map((e) => `« ${CommandeService.libelleStatut(e)} »`)
        .join(', ');
      throw new BadRequestError(
        `Cette commande est « ${CommandeService.libelleStatut(commande.statut)} » : `
        + `elle ne peut pas passer à « ${CommandeService.libelleStatut(statut)} ». `
        + (possibles ? `Transitions possibles : ${possibles}.` : 'Elle est arrivée au bout de son parcours.')
      );
    }

    const CHAMPS = ['adresseLivraison', 'numeroTelephone', 'note', 'clientNom', 'clientPrenom', 'clientTelephone', 'clientEmail', 'modeLivraison', 'modePaiement'];
    const t = await sequelize.transaction();
    const statutAvant = commande.statut;
    let devientLivree = false;
    let statutChange = false;
    try {
      for (const champ of CHAMPS) {
        if (donnees[champ] !== undefined) commande[champ] = donnees[champ] === '' ? null : donnees[champ];
      }
      if (statut && statut !== commande.statut) {
        statutChange = true;
        devientLivree = statut === 'livree';
        // Marchandise engagée : on réserve le stock s'il ne l'est pas encore.
        if (STATUTS_ENGAGES.includes(statut) && !commande.stockDecremente) {
          await CommandeService._decrementerStock(commande, t);
        }
        commande.statut = statut;
      }
      await commande.save({ transaction: t });
      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }

    if (statutChange) {
      CommandeService._historiser({
        commandeId: commande.id,
        auteurId: adminId,
        auteurRole: 'admin',
        operation: 'statut',
        statutAvant,
        statutApres: commande.statut,
        motif: donnees.motif || null,
      });
    }
    if (devientLivree) CommandeService._incrementerVentes(commande.id).catch(echecIgnore('compteur de ventes'));
    if (statutChange) CommandeService._notifierAcheteurStatut(commande).catch(echecIgnore('notification de statut à l\'acheteur'));
    return AdminCatalogueService.detailCommande(id);
  }

  /**
   * Une commande ne se supprime jamais.
   *
   * Le modèle n'étant pas `paranoid`, `destroy()` effacerait la commande avec
   * ses lignes et son historique : plus moyen de savoir ce qui a été vendu,
   * à qui, ni pourquoi le stock a bougé.
   *
   * La route reste en place pour ne pas casser le back-office, mais elle
   * répond par un refus explicite qui dit quoi faire à la place.
   * L'annulation, elle, garde tout : la commande reste lisible, son statut
   * dit ce qui s'est passé.
   */
  static async supprimerCommande(id) {
    const commande = await Commande.findByPk(id);
    if (!commande) throw new NotFoundError('Commande introuvable');
    throw new ConflictError(
      'Une commande ne se supprime pas : son historique doit être conservé. '
      + (commande.statut === 'annulee'
        ? 'Celle-ci est déjà annulée.'
        : 'Annulez-la plutôt — le stock réservé sera rendu.')
    );
  }
}

module.exports = AdminCatalogueService;
