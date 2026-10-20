const { Utilisateur, Produit, Categorie, Abonnement, Paiement, Boutique, Signalement, Notification, Commande, LigneCommande } = require('../../models');
const logger = require('../../utils/logger');
const CategorieAdminService = require('../categories/categorieAdmin.service');
const { paginate, metaPagination } = require('../../utils/paginate');
const { Op, fn, col, literal } = require('sequelize');
const sequelize = require('../../config/db');
const { BadRequestError, ForbiddenError, ConflictError, NotFoundError } = require('../../errors/AppError');
const bcrypt = require('bcryptjs');
const { generatePassword } = require('../../utils/generatePassword');
const { bcryptConfig } = require('../../config/security');
const { sendAccesUtilisateurEmail } = require('../resend.service');

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

  // 7. Créer une catégorie — logique dans CategorieAdminService
  static async creerCategorie(data) {
    return CategorieAdminService.creer(data);
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

  // ── Création / modification d'un client ou d'un vendeur depuis le dashboard ──

  /** Champs d'identité modifiables, nettoyés. */
  static _identite({ prenom, nom, email, telephone, adresse } = {}) {
    const champs = {};
    if (prenom !== undefined) champs.prenom = String(prenom).trim();
    if (nom !== undefined) champs.nom = String(nom).trim();
    if (email !== undefined) champs.email = String(email).trim().toLowerCase();
    if (telephone !== undefined) {
      const t = String(telephone).replace(/[\s.-]/g, '');
      champs.telephone = t || null;
    }
    if (adresse !== undefined) champs.adresse = String(adresse).trim() || null;
    return champs;
  }

  /** Email et téléphone uniques : message clair plutôt qu'une erreur SQL. */
  static async _verifierUnicite({ email, telephone }, saufId = null) {
    const exclure = saufId ? { id: { [Op.ne]: saufId } } : {};
    if (email && await Utilisateur.findOne({ where: { email, ...exclure } })) {
      throw new ConflictError('Cet email est déjà utilisé par un autre compte.');
    }
    if (telephone && await Utilisateur.findOne({ where: { telephone, ...exclure } })) {
      throw new ConflictError('Ce numéro de téléphone est déjà utilisé par un autre compte.');
    }
  }

  /**
   * Crée un compte client (« Acheteur ») ou vendeur. Un mot de passe
   * provisoire est généré et envoyé par email. Un vendeur reçoit, comme à
   * l'inscription, un mois d'essai.
   */
  static async creerUtilisateur(role, donnees) {
    if (!['Acheteur', 'Vendeur'].includes(role)) throw new BadRequestError('Rôle invalide');
    const champs = this._identite(donnees);
    if (!champs.prenom || !champs.nom) throw new BadRequestError('Prénom et nom sont requis.');
    if (!champs.email || !/^\S+@\S+\.\S+$/.test(champs.email)) throw new BadRequestError('Email invalide.');
    if (champs.telephone && !/^\+?\d{7,15}$/.test(champs.telephone)) throw new BadRequestError('Téléphone invalide.');
    await this._verifierUnicite(champs);

    const password = generatePassword();
    const t = await sequelize.transaction();
    try {
      const utilisateur = await Utilisateur.create({
        ...champs,
        mot_de_passe: await bcrypt.hash(password, bcryptConfig.saltRounds),
        role,
        statut: 'actif',
        verifie: true,
      }, { transaction: t });

      if (role === 'Vendeur') {
        const dateDebut = new Date();
        const dateFin = new Date();
        dateFin.setMonth(dateFin.getMonth() + 1);
        await Abonnement.create({
          utilisateurId: utilisateur.id, type: 'essai', dateDebut, dateFin, montant: 0,
        }, { transaction: t });
      }
      await t.commit();

      sendAccesUtilisateurEmail({
        to: utilisateur.email,
        prenom: utilisateur.prenom,
        nom: utilisateur.nom,
        email: utilisateur.email,
        password,
        role,
      }).catch((err) => logger.error('sendAccesUtilisateurEmail:failed', { error: err.message }));

      const brut = utilisateur.toJSON();
      delete brut.mot_de_passe;
      return { message: `${role === 'Vendeur' ? 'Vendeur' : 'Client'} créé — ses accès lui ont été envoyés par email.`, utilisateur: brut };
    } catch (err) {
      await t.rollback();
      throw err;
    }
  }

  /** Modifie l'identité d'un client ou d'un vendeur (jamais d'un admin). */
  static async modifierUtilisateur(role, id, donnees) {
    const utilisateur = await Utilisateur.findOne({ where: { id, role } });
    if (!utilisateur) throw new NotFoundError(role === 'Vendeur' ? 'Vendeur introuvable' : 'Client introuvable');
    const champs = this._identite(donnees);
    if (champs.prenom === '' || champs.nom === '') throw new BadRequestError('Prénom et nom sont requis.');
    if (champs.email !== undefined && !/^\S+@\S+\.\S+$/.test(champs.email)) throw new BadRequestError('Email invalide.');
    if (champs.telephone && !/^\+?\d{7,15}$/.test(champs.telephone)) throw new BadRequestError('Téléphone invalide.');
    await this._verifierUnicite(champs, id);
    await utilisateur.update(champs);
    const brut = utilisateur.toJSON();
    delete brut.mot_de_passe;
    return { message: 'Informations mises à jour', utilisateur: brut };
  }

  /** Réactive un client suspendu. */
  static async activerAcheteur(acheteurId) {
    const acheteur = await Utilisateur.findOne({ where: { id: acheteurId, role: 'Acheteur' } });
    if (!acheteur) throw new NotFoundError('Acheteur introuvable');
    await acheteur.update({ statut: 'actif' });
    return { message: 'Client réactivé avec succès' };
  }

  // 16b. Supprimer un utilisateur (vendeur ou acheteur) — pas un admin
  static async supprimerUtilisateur(userId, roleAttendu = null) {
    const user = await Utilisateur.findByPk(userId);
    if (!user || (roleAttendu && user.role !== roleAttendu)) throw new NotFoundError('Utilisateur introuvable');
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

  // `paginate` borne `limit` à 100 : ces routes prenaient la valeur de la
  // requête telle quelle, et `?limit=1000000` chargeait toute la table.
  static async tousLesPaiements({ statut, page = 1, limit = 20 } = {}) {
    const where = {};
    if (statut) where.statut = statut;
    const p = paginate(page, limit);
    const { count, rows } = await Paiement.findAndCountAll({
      where,
      include: [{
        model: Utilisateur, as: 'utilisateur',
        attributes: ['id', 'nom', 'prenom', 'email']
      }],
      order: [['createdAt', 'DESC']],
      limit: p.limit,
      offset: p.offset,
    });
    return {
      message: 'Liste des paiements',
      total: count,
      page: p.page,
      paiements: rows,
      pagination: { ...metaPagination(count, p.page, p.limit), totalPages: Math.ceil(count / p.limit) },
    };
  }

  // Paginé lui aussi : les échecs s'accumulent (chaque tentative Orange Money
  // abandonnée en crée un) et la liste était renvoyée en entier.
  static async paiementsEchoues({ page = 1, limit = 20 } = {}) {
    const p = paginate(page, limit);
    const { count, rows } = await Paiement.findAndCountAll({
      where: { statut: 'failed' },
      include: [{
        model: Utilisateur, as: 'utilisateur',
        attributes: ['id', 'nom', 'prenom', 'email']
      }],
      order: [['createdAt', 'DESC']],
      limit: p.limit,
      offset: p.offset,
    });
    return {
      message: 'Paiements échoués',
      total: count,
      page: p.page,
      paiements: rows,
      pagination: { ...metaPagination(count, p.page, p.limit), totalPages: Math.ceil(count / p.limit) },
    };
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

  static async listerCategories() {
    return CategorieAdminService.lister();
  }

  static async modifierCategorie(categorieId, data) {
    return CategorieAdminService.modifier(categorieId, data);
  }

  static async supprimerCategorie(categorieId, options = {}) {
    return CategorieAdminService.supprimer(categorieId, options);
  }

  static async reordonnerCategories(ids) {
    return CategorieAdminService.reordonner(ids);
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
  static async toutesLesCommandes({ statut, boutiqueId, page = 1, limit = 20 } = {}) {
    const where = {};
    if (statut) where.statut = statut;
    if (boutiqueId) {
      const boutique = await Boutique.findByPk(boutiqueId, { attributes: ['vendeurId'] });
      if (!boutique) throw new NotFoundError('Boutique introuvable');
      where.vendeurId = boutique.vendeurId;
    }

    // Borne haute à 100 (voir utils/paginate) ; `page` et `limit` arrivent
    // de la requête sans contrôle.
    ({ page, limit } = paginate(page, limit));
    const offset = (page - 1) * limit;

    const { rows, count } = await Commande.findAndCountAll({
      where,
      include: [
        { model: Utilisateur, as: 'acheteur', attributes: ['id', 'nom', 'prenom', 'telephone'] },
        {
          model: Utilisateur, as: 'vendeur', attributes: ['id', 'nom', 'prenom', 'telephone'],
          include: [{ model: Boutique, as: 'boutiques', attributes: ['id', 'nom'] }],
        },
        { model: LigneCommande, as: 'lignes', attributes: ['id', 'quantite'] },
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit, 10),
      offset,
      distinct: true,
    });

    return {
      // La boutique est remontée à plat : c'est elle que l'admin reconnaît.
      commandes: rows.map((r) => {
        const o = r.toJSON();
        const b = o.vendeur?.boutiques?.[0];
        return { ...o, boutique: b ? { id: b.id, nom: b.nom } : null };
      }),
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