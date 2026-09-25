const { Utilisateur, Produit, Categorie, Abonnement, Paiement, Boutique, Signalement, Notification, Commande, LigneCommande } = require('../../models');
const logger = require('../../utils/logger');
const { Op, fn, col, literal } = require('sequelize');
const sequelize = require('../../config/db');
const { BadRequestError, ForbiddenError, ConflictError, NotFoundError } = require('../../errors/AppError');

class AdminService {

  // 1. Lister tous les vendeurs
  static async listerVendeur() {
    try {
      const vendeurs = await Utilisateur.findAll({
        attributes: { exclude: ['mot_de_passe'] },
        where: { role: 'Vendeur' },
        order: [['createdAt', 'DESC']]
      });

      return {
        message: "Liste des vendeurs",
        vendeurs
      };

    } catch (error) {
      console.error("Erreur listerVendeur :", error);
      throw error;
    }
  }

  // 2. Nombre total de vendeurs actif
  static async nombreVendeursActif() {
    const total = await Utilisateur.count({
      where: { role: 'Vendeur', statut: 'actif' }
    });

    return {
      message: "Nombre total de vendeurs actif",
      totalVendeurs: total
    };
  }

   // 2. Nombre total de vendeurs actif
  static async nombreVendeursInactif() {
    const total = await Utilisateur.count({
      where: { role: 'Vendeur', statut: 'inactif' }
    });

    return {
      message: "Nombre total de vendeurs inactif",
      totalVendeurs: total
    };
  }

  // 3. Lister tous les produits actifs
  static async listerProduitsActifs() {
    try {
      const { rows } = await Produit.findAndCountAll({
        where: { quantite: { [Op.gt]: 0 } },
        include: [
          {
            model: Utilisateur,
            as: 'vendeur',
            attributes: ['id', 'nom', 'prenom']
          },
          {
            model: Categorie,
            as: 'categorie',
            attributes: ['id', 'nom']
          }
        ],
        order: [['createdAt', 'DESC']],
      });

      return {
        message: "Liste des produits actifs",
        produits: rows
      };

    } catch (error) {
      console.error("Erreur listerProduitsActifs :", error);
      throw error;
    }
  }

  // 4. Nombre total de clients actifs
  static async nombreClientsActifs() {
    const total = await Utilisateur.count({
      where: { role: 'Acheteur', statut: 'actif' }
    });

    return {
      message: "Nombre total de clients actifs",
      totalClients: total
    };
  }

  // 4. Nombre total de clients actifs
  static async nombreClientsInactifs() {
    const total = await Utilisateur.count({
      where: { role: 'Acheteur', statut: 'inactif' }
    });

    return {
      message: "Nombre total de clients inactifs",
      totalClients: total
    };
  }

  // 5. Liste des clients
  static async listerClients() {
    try {

      const { rows } = await Utilisateur.findAndCountAll({
        where: { role: 'Acheteur' },
        attributes: { exclude: ['mot_de_passe'] },
        order: [['createdAt', 'DESC']]
      });

      return {
        message: "Liste des clients",
        clients: rows
      };

    } catch (error) {
      console.error("Erreur listerClients :", error);
      throw error;
    }
  }

  // 6. Nombre total de produits actifs
  static async nombreProduitsActifs() {
    const total = await Produit.count({
      where: { quantite: { [Op.gt]: 0 } }
    });

    return {
      message: "Nombre total de produits actifs",
      totalProduits: total
    };
  }

  // 7. Créer une catégorie
static async creerCategorie(data) {
  try {
    const { nom, description } = data;

    // Vérifier si la catégorie existe déjà
    const existe = await Categorie.findOne({
      where: { nom }
    });

    if (existe) {
      return {
        message: "Cette catégorie existe déjà",
      };
    }

    // Création
    const categorie = await Categorie.create({
      nom,
      description
    });

    return {
      message: "Catégorie créée avec succès",
      categorie
    };

  } catch (error) {
    console.error("Erreur creerCategorie :", error);
    throw error;
  }
}

  // 8. Suspendre un vendeur
  static async suspendreVendeur(vendeurId) {
    const vendeur = await Utilisateur.findOne({ where: { id: vendeurId, role: 'Vendeur' } });
    if (!vendeur) throw new NotFoundError('Vendeur introuvable');
    await vendeur.update({ statut: 'inactif' });
    return { message: 'Vendeur suspendu avec succès' };
  }

  // 9. Activer un vendeur
  static async activerVendeur(vendeurId) {
    const vendeur = await Utilisateur.findOne({ where: { id: vendeurId, role: 'Vendeur' } });
    if (!vendeur) throw new NotFoundError('Vendeur introuvable');
    await vendeur.update({ statut: 'actif' });
    return { message: 'Vendeur activé avec succès' };
  }

  // 10. Suspendre un acheteur
  static async suspendreAcheteur(acheteurId) {
    const acheteur = await Utilisateur.findOne({ where: { id: acheteurId, role: 'Acheteur' } });
    if (!acheteur) throw new NotFoundError('Acheteur introuvable');
    await acheteur.update({ statut: 'inactif' });
    return { message: 'Acheteur suspendu avec succès' };
  }

  // 11. Lister les abonnements
  static async getAbonnements() {
    const abonnements = await Abonnement.findAll({
      include: [{ model: Utilisateur, as: 'utilisateur', attributes: { exclude: ['mot_de_passe'] } }],
      order: [['createdAt', 'DESC']]
    });
    return { message: 'Liste des abonnements', abonnements };
  }

  // 13. Approuver un produit
  static async approuverProduit(produitId) {
    const produit = await Produit.findByPk(produitId);
    if (!produit) throw new NotFoundError('Produit introuvable');
    await produit.update({ statut: 'approuve' });
    return { message: 'Produit approuvé avec succès' };
  }

  // 14. Rejeter un produit
  static async rejeterProduit(produitId) {
    const produit = await Produit.findByPk(produitId);
    if (!produit) throw new NotFoundError('Produit introuvable');
    await produit.update({ statut: 'rejete' });
    return { message: 'Produit rejeté avec succès' };
  }

  // 15. Supprimer un produit
  static async supprimerProduit(produitId) {
    const produit = await Produit.findByPk(produitId);
    if (!produit) throw new NotFoundError('Produit introuvable');
    await produit.destroy({ force: true });
    return { message: 'Produit supprimé avec succès' };
  }

  // 16. Supprimer une boutique
  static async supprimerBoutique(boutiqueId) {
    const boutique = await Boutique.findByPk(boutiqueId);
    if (!boutique) throw new NotFoundError('Boutique introuvable');
    await boutique.destroy({ force: true });
    return { message: 'Boutique supprimée avec succès' };
  }

  // 16b. Supprimer un utilisateur (vendeur ou acheteur) — pas un admin
  static async supprimerUtilisateur(userId) {
    const user = await Utilisateur.findByPk(userId);
    if (!user) throw new NotFoundError('Utilisateur introuvable');
    if (user.role === 'Admin') throw new ForbiddenError("Impossible de supprimer un administrateur ici");
    // Suppression logique (paranoid) ; les boutiques/produits liés suivent la cascade
    await user.destroy();
    return { message: 'Utilisateur supprimé avec succès' };
  }

  // 17. Vérifier un vendeur
  static async verifierVendeur(vendeurId) {
    const vendeur = await Utilisateur.findOne({ where: { id: vendeurId, role: 'Vendeur' } });
    if (!vendeur) throw new NotFoundError('Vendeur introuvable');
    await vendeur.update({ verifie: true });
    return { message: 'Vendeur vérifié avec succès' };
  }

  // ==============================
  // VALIDATION DES PROFILS VENDEURS
  // ==============================
  // À ne pas confondre avec `verifierVendeur` ci-dessus, qui ne fait que
  // marquer l'email comme confirmé. Ici l'administrateur examine une pièce
  // justificative et engage la responsabilité de la plateforme.

  /** Demandes en attente, la plus ancienne d'abord (file d'attente). */
  static async vendeursAValider() {
    const vendeurs = await Utilisateur.findAll({
      where: { role: 'Vendeur', statutValidation: 'en_attente' },
      attributes: [
        'id', 'prenom', 'nom', 'email', 'telephone',
        'pieceIdentite', 'typePiece', 'dateSoumission', 'createdAt',
      ],
      include: [{
        model: Boutique,
        as: 'boutiques',
        attributes: ['id', 'nom', 'categorie', 'localisation', 'logo'],
        required: false,
      }],
      order: [['dateSoumission', 'ASC']],
    });
    return { message: 'Profils vendeurs en attente de validation', vendeurs };
  }

  static async validerProfilVendeur(vendeurId, adminId) {
    const vendeur = await Utilisateur.findOne({ where: { id: vendeurId, role: 'Vendeur' } });
    if (!vendeur) throw new NotFoundError('Vendeur introuvable');

    await vendeur.update({
      statutValidation: 'approuve',
      dateValidation: new Date(),
      validePar: adminId,
      motifRejet: null,
    });

    return { message: 'Profil vendeur approuvé', vendeurId };
  }

  static async rejeterProfilVendeur(vendeurId, adminId, motif) {
    const vendeur = await Utilisateur.findOne({ where: { id: vendeurId, role: 'Vendeur' } });
    if (!vendeur) throw new NotFoundError('Vendeur introuvable');
    if (!motif || !motif.trim()) throw new BadRequestError('Un motif de rejet est requis');

    // Le vendeur repasse en « rejeté » et non en « non soumis » : il doit
    // pouvoir lire pourquoi avant de retenter.
    await vendeur.update({
      statutValidation: 'rejete',
      motifRejet: motif.trim(),
      dateValidation: new Date(),
      validePar: adminId,
    });

    return { message: 'Profil vendeur rejeté', vendeurId };
  }

  // 18. Lister les signalements en attente
  static async getSignalements() {
    const signalements = await Signalement.findAll({
      where: { statut: 'en_attente' },
      include: [{ model: Utilisateur, as: 'signaleur', attributes: ['id', 'prenom', 'nom'] }],
      order: [['createdAt', 'DESC']]
    });
    return { message: 'Liste des signalements en attente', signalements };
  }

  // 19. Traiter un signalement
  static async traiterSignalement(signalementId) {
    const signalement = await Signalement.findByPk(signalementId);
    if (!signalement) throw new NotFoundError('Signalement introuvable');
    await signalement.update({ statut: 'traite' });
    return { message: 'Signalement marqué comme traité' };
  }

  // 20. Rejeter un signalement
  static async rejeterSignalement(signalementId) {
    const signalement = await Signalement.findByPk(signalementId);
    if (!signalement) throw new NotFoundError('Signalement introuvable');
    await signalement.update({ statut: 'rejete' });
    return { message: 'Signalement rejeté' };
  }

  // 12. Stats globales
  static async getStatsGlobales() {
    const [totalVendeurs, totalAcheteurs, totalProduits, abonnementsActifs, paiements] = await Promise.all([
      Utilisateur.count({ where: { role: 'Vendeur' } }),
      Utilisateur.count({ where: { role: 'Acheteur' } }),
      Produit.count(),
      Abonnement.count({ where: { statut: 'actif' } }),
      Paiement.findAll({ where: { statut: 'success' }, attributes: ['montant'] })
    ]);

    const revenus = paiements.reduce((sum, p) => sum + parseFloat(p.montant || 0), 0);

    return {
      message: 'Statistiques globales',
      stats: { totalVendeurs, totalAcheteurs, totalProduits, abonnementsActifs, revenus }
    };
  }

  // ======================== KPIs ========================

  static async revenusParMois(annee) {
    const anneeTarget = annee || new Date().getFullYear();
    const rows = await Paiement.findAll({
      where: {
        statut: 'success',
        createdAt: {
          [Op.between]: [
            new Date(`${anneeTarget}-01-01`),
            new Date(`${anneeTarget}-12-31T23:59:59`)
          ]
        }
      },
      attributes: [
        [fn('to_char', col('created_at'), 'YYYY-MM'), 'mois'],
        [fn('SUM', col('montant')), 'total'],
        [fn('COUNT', col('id')), 'nombrePaiements']
      ],
      group: [literal("to_char(created_at, 'YYYY-MM')")],
      order: [[literal("to_char(created_at, 'YYYY-MM')"), 'ASC']],
      raw: true
    });
    return { message: `Revenus mensuels ${anneeTarget}`, revenus: rows };
  }

  static async inscriptionsMensuelles(annee) {
    const anneeTarget = annee || new Date().getFullYear();
    const rows = await Utilisateur.findAll({
      where: {
        createdAt: {
          [Op.between]: [
            new Date(`${anneeTarget}-01-01`),
            new Date(`${anneeTarget}-12-31T23:59:59`)
          ]
        }
      },
      attributes: [
        'role',
        [fn('to_char', col('created_at'), 'YYYY-MM'), 'mois'],
        [fn('COUNT', col('id')), 'total']
      ],
      group: ['role', literal("to_char(created_at, 'YYYY-MM')")],
      order: [[literal("to_char(created_at, 'YYYY-MM')"), 'ASC']],
      raw: true
    });
    return { message: `Inscriptions mensuelles ${anneeTarget}`, inscriptions: rows };
  }

  static async abonnementsExpirationProche(jours = 7) {
    const limite = new Date();
    limite.setDate(limite.getDate() + parseInt(jours));
    const abonnements = await Abonnement.findAll({
      where: {
        statut: 'actif',
        dateFin: { [Op.between]: [new Date(), limite] }
      },
      include: [{
        model: Utilisateur, as: 'utilisateur',
        attributes: ['id', 'nom', 'prenom', 'email', 'telephone']
      }],
      order: [['dateFin', 'ASC']]
    });
    return { message: `Abonnements expirant dans ${jours} jours`, abonnements };
  }

  // ======================== PAIEMENTS ========================

  static async tousLesPaiements({ statut, page = 1, limit = 20 }) {
    const where = {};
    if (statut) where.statut = statut;
    const offset = (page - 1) * limit;
    const { count, rows } = await Paiement.findAndCountAll({
      where,
      include: [{
        model: Utilisateur, as: 'utilisateur',
        attributes: ['id', 'nom', 'prenom', 'email']
      }],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset
    });
    return { message: 'Liste des paiements', total: count, page: parseInt(page), paiements: rows };
  }

  static async paiementsEchoues() {
    const paiements = await Paiement.findAll({
      where: { statut: 'failed' },
      include: [{
        model: Utilisateur, as: 'utilisateur',
        attributes: ['id', 'nom', 'prenom', 'email']
      }],
      order: [['createdAt', 'DESC']]
    });
    return { message: 'Paiements échoués', paiements };
  }

  // ======================== ABONNEMENT MANUEL ========================

  // M-04 : adminId ajouté pour audit trail
  static async abonnementManuel(vendeurId, adminId) {
    const vendeur = await Utilisateur.findOne({ where: { id: vendeurId, role: 'Vendeur' } });
    if (!vendeur) throw new NotFoundError('Vendeur introuvable');

    const dateDebut = new Date();
    const dateFin = new Date();
    dateFin.setMonth(dateFin.getMonth() + 1);

    const abonnement = await Abonnement.create({
      utilisateurId: vendeurId,
      type: 'mensuel',
      dateDebut,
      dateFin,
      montant: 0,
      statut: 'actif'
    });

    // Audit trail — M-04
    logger.info('AUDIT:abonnementManuel', {
      action: 'abonnement_manuel',
      adminId,
      vendeurId,
      vendeurEmail: vendeur.email,
      abonnementId: abonnement.id,
      dateFin,
      at: new Date().toISOString(),
    });

    return { message: 'Abonnement gratuit accordé avec succès', abonnement };
  }

  static async revoquerAbonnement(abonnementId) {
    const abonnement = await Abonnement.findByPk(abonnementId);
    if (!abonnement) throw new NotFoundError('Abonnement introuvable');
    await abonnement.update({ statut: 'expire' });
    return { message: 'Abonnement révoqué avec succès' };
  }

  // ======================== CATÉGORIES ========================

  static async modifierCategorie(categorieId, data) {
    const categorie = await Categorie.findByPk(categorieId);
    if (!categorie) throw new NotFoundError('Catégorie introuvable');
    const { nom, description } = data;
    if (nom && nom !== categorie.nom) {
      const existe = await Categorie.findOne({ where: { nom } });
      if (existe) throw new ConflictError('Ce nom de catégorie est déjà utilisé');
    }
    await categorie.update({ nom: nom || categorie.nom, description: description ?? categorie.description });
    return { message: 'Catégorie modifiée avec succès', categorie };
  }

  static async supprimerCategorie(categorieId) {
    const categorie = await Categorie.findByPk(categorieId);
    if (!categorie) throw new NotFoundError('Catégorie introuvable');
    const nbProduits = await Produit.count({ where: { categorieId } });
    if (nbProduits > 0) throw new ConflictError(`Impossible de supprimer : ${nbProduits} produit(s) utilisent cette catégorie`);
    await categorie.destroy();
    return { message: 'Catégorie supprimée avec succès' };
  }

  // ======================== NOTIFICATION BROADCAST ========================

  static async notificationGlobale({ titre, message, type = 'systeme', cible = 'tous' }) {
    const whereRole = {};
    if (cible === 'vendeurs') whereRole.role = 'Vendeur';
    else if (cible === 'acheteurs') whereRole.role = 'Acheteur';

    const utilisateurs = await Utilisateur.findAll({
      where: { ...whereRole, statut: 'actif' },
      attributes: ['id']
    });

    if (utilisateurs.length === 0) return { message: 'Aucun utilisateur cible trouvé', envoyes: 0 };

    const notifications = utilisateurs.map(u => ({
      utilisateurId: u.id,
      titre,
      message,
      type,
      lue: false
    }));

    await Notification.bulkCreate(notifications);
    return { message: `Notification envoyée à ${utilisateurs.length} utilisateur(s)`, envoyes: utilisateurs.length };
  }

  // ======================== MODÉRATION AVANCÉE ========================

  static async produitsEnAttente() {
    const produits = await Produit.findAll({
      where: { statut: 'en_attente' },
      include: [
        { model: Utilisateur, as: 'vendeur', attributes: ['id', 'nom', 'prenom'] },
        { model: Categorie, as: 'categorie', attributes: ['id', 'nom'] }
      ],
      order: [['createdAt', 'ASC']]
    });
    return { message: 'Produits en attente de modération', produits };
  }

  // -------------------- COMMANDES (e-commerce) --------------------

  // Liste paginée de toutes les commandes (filtrable par statut)
  static async toutesLesCommandes({ statut, page = 1, limit = 20 } = {}) {
    const where = {};
    if (statut) where.statut = statut;

    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const { rows, count } = await Commande.findAndCountAll({
      where,
      include: [
        { model: Utilisateur, as: 'acheteur', attributes: ['id', 'nom', 'prenom', 'telephone'] },
        { model: Utilisateur, as: 'vendeur', attributes: ['id', 'nom', 'prenom', 'telephone'] },
        { model: LigneCommande, as: 'lignes', attributes: ['id', 'quantite'] },
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit, 10),
      offset,
      distinct: true,
    });

    return {
      commandes: rows,
      pagination: {
        total: count,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        totalPages: Math.ceil(count / parseInt(limit, 10)),
      },
    };
  }

  // Statistiques e-commerce globales
  static async statsEcommerce() {
    // Chiffre d'affaires = somme des commandes payées
    const caRow = await Commande.findOne({
      attributes: [[fn('COALESCE', fn('SUM', col('montant_total')), 0), 'ca']],
      where: { statut_paiement: 'paye' },
      raw: true,
    });
    const chiffreAffaires = parseFloat(caRow?.ca || 0);

    const totalCommandes = await Commande.count();
    const commandesPayees = await Commande.count({ where: { statutPaiement: 'paye' } });
    const panierMoyen = commandesPayees > 0 ? chiffreAffaires / commandesPayees : 0;

    // Répartition par statut
    const parStatutRaw = await Commande.findAll({
      attributes: ['statut', [fn('COUNT', col('id')), 'nombre']],
      group: ['statut'],
      raw: true,
    });
    const parStatut = {};
    for (const r of parStatutRaw) {
      parStatut[r.statut] = parseInt(r.nombre, 10);
    }

    return {
      chiffreAffaires,
      totalCommandes,
      commandesPayees,
      panierMoyen: Math.round(panierMoyen),
      parStatut,
    };
  }

}

module.exports = AdminService;