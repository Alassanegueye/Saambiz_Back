const {
  Produit, Categorie, Boutique, Utilisateur, ProduitImage, Commande, LigneCommande,
} = require('../../models');
const { Op } = require('sequelize');
const sequelize = require('../../config/db');
const VendeurService = require('../vendeurs/vendeur.service');
const CommandeService = require('../commandes/commande.service');
const { BadRequestError, ConflictError, NotFoundError } = require('../../errors/AppError');

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

const STATUTS_COMMANDE = ['en_attente', 'confirmee', 'en_preparation', 'prete', 'en_livraison', 'livree', 'annulee'];
const STATUTS_PAIEMENT = ['non_paye', 'paye', 'rembourse'];
// Statuts où la marchandise est engagée : le stock doit être réservé.
const STATUTS_ENGAGES = ['confirmee', 'en_preparation', 'prete', 'en_livraison', 'livree'];

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

  static async listerProduits({ boutiqueId, statut } = {}) {
    const where = {};
    if (boutiqueId) where.vendeurId = await AdminCatalogueService._vendeurIdDeBoutique(boutiqueId);
    if (statut === 'disponibles') Object.assign(where, { disponible: true, quantite: { [Op.gt]: 0 } });
    if (statut === 'indisponibles') where[Op.or] = [{ disponible: false }, { quantite: { [Op.lte]: 0 } }];

    const produits = await Produit.findAll({
      where,
      include: [VENDEUR_AVEC_BOUTIQUE, { model: Categorie, as: 'categorie', attributes: ['id', 'nom'] }],
      order: [['createdAt', 'DESC']],
    });
    return { produits: produits.map(aplatir) };
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
  static async modifierCommande(id, donnees) {
    const commande = await Commande.findByPk(id);
    if (!commande) throw new NotFoundError('Commande introuvable');

    const { statut, statutPaiement } = donnees;
    if (statut && !STATUTS_COMMANDE.includes(statut)) throw new BadRequestError('Statut inconnu');
    if (statutPaiement && !STATUTS_PAIEMENT.includes(statutPaiement)) {
      throw new BadRequestError('Statut de paiement inconnu');
    }
    if (commande.statut === 'annulee' && statut && statut !== 'annulee') {
      throw new BadRequestError('Une commande annulée ne peut pas être relancée : créez-en une nouvelle');
    }

    // Annulation : stock restauré, paiement passé en remboursé, acheteur prévenu.
    if (statut === 'annulee' && commande.statut !== 'annulee') {
      await CommandeService._annuler(commande, 'vendeur');
      return AdminCatalogueService.detailCommande(id);
    }

    const CHAMPS = ['adresseLivraison', 'numeroTelephone', 'note', 'clientNom', 'clientPrenom', 'clientTelephone', 'clientEmail', 'modeLivraison', 'modePaiement'];
    const t = await sequelize.transaction();
    let devientLivree = false;
    let statutChange = false;
    try {
      for (const champ of CHAMPS) {
        if (donnees[champ] !== undefined) commande[champ] = donnees[champ] === '' ? null : donnees[champ];
      }
      if (statutPaiement) commande.statutPaiement = statutPaiement;
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

    if (devientLivree) CommandeService._incrementerVentes(commande.id).catch(() => {});
    if (statutChange) CommandeService._notifierAcheteurStatut(commande).catch(() => {});
    return AdminCatalogueService.detailCommande(id);
  }

  static async supprimerCommande(id) {
    const commande = await Commande.findByPk(id);
    if (!commande) throw new NotFoundError('Commande introuvable');
    if (commande.statutPaiement === 'paye') {
      throw new ConflictError('Commande payée : annulez-la (le paiement passe en remboursé) au lieu de la supprimer');
    }
    const t = await sequelize.transaction();
    try {
      await CommandeService._restaurerStock(commande, t);
      await commande.destroy({ transaction: t });
      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
    return { message: 'Commande supprimée' };
  }
}

module.exports = AdminCatalogueService;
