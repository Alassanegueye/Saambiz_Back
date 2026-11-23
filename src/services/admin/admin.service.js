const { Utilisateur, Produit, Categorie, Abonnement, Paiement, Boutique, Signalement, Notification, Commande, LigneCommande } = require('../../models');
const logger = require('../../utils/logger');
const echecIgnore = require('../../utils/echecIgnore');
const CategorieAdminService = require('../categories/categorieAdmin.service');
const { paginate, metaPagination } = require('../../utils/paginate');
const { Op, fn, col, literal } = require('sequelize');
const sequelize = require('../../config/db');
const { BadRequestError, ForbiddenError, ConflictError, NotFoundError } = require('../../errors/AppError');
const bcrypt = require('bcryptjs');
const { generatePassword } = require('../../utils/generatePassword');
const { bcryptConfig } = require('../../config/security');
const { sendAccesUtilisateurEmail, sendCertificationEmail } = require('../resend.service');

/**
 * Les trois états d'un abonnement, dans l'ordre de l'énumération du modèle.
 * `revoque` est distinct d'`expire` : un abonnement retiré par un
 * administrateur n'est pas un abonnement arrivé à son terme, et le
 * back-office doit pouvoir faire la différence.
 */
const STATUTS_ABONNEMENT = ['actif', 'expire', 'revoque'];
const { urlLecture } = require('../stockage/upload.service');

class AdminService {

  /**
   * Clause de recherche d'un compte : nom, prénom, e-mail, téléphone.
   */
  static _rechercheCompte(recherche) {
    return AdminService._recherche(recherche, ['nom', 'prenom', 'email', 'telephone']);
  }

  /**
   * Clause correspondant à un filtre d'état de compte.
   *
   * Un compte supprimé par son titulaire n'est ni actif ni suspendu : il est
   * parti. Le confondre avec une suspension faisait proposer un
   * « Réactiver » sans effet — l'API refuse la connexion de toute façon.
   */
  static _filtreStatutCompte(statut) {
    if (statut === 'actifs') return { statut: 'actif', compteSupprime: false };
    if (statut === 'inactifs') return { statut: 'inactif', compteSupprime: false };
    if (statut === 'supprimes') return { compteSupprime: true };
    return {};
  }

  /**
   * Combien de comptes dans chaque état, pour les pastilles de filtre.
   *
   * Ces effectifs viennent du serveur depuis que les listes sont paginées :
   * calculés sur la page affichée, ils auraient annoncé « 2 actifs » quand
   * la plateforme en compte deux cents.
   */
  static async _compteursComptes(role, base = {}) {
    const compter = (extra) => Utilisateur.count({ where: { role, ...base, ...extra } });
    const [tous, actifs, inactifs, supprimes] = await Promise.all([
      compter({}),
      compter(AdminService._filtreStatutCompte('actifs')),
      compter(AdminService._filtreStatutCompte('inactifs')),
      compter(AdminService._filtreStatutCompte('supprimes')),
    ]);
    return { '': tous, actifs, inactifs, supprimes };
  }

  /**
   * Liste de comptes, paginée **à la demande**.
   *
   * Sans `page` ni `limit`, la liste entière est renvoyée comme avant : le
   * formulaire de commande du back-office appelle cette route pour remplir
   * son menu déroulant de clients, et une page de dix l'aurait amputé sans
   * que rien ne le dise. La pagination est donc une demande explicite de
   * l'appelant, pas un changement imposé à tous.
   */
  static async _listerComptes({ role, cle, inclure, statut, recherche, page, limit }) {
    const where = {
      role,
      ...AdminService._filtreStatutCompte(statut),
      ...AdminService._rechercheCompte(recherche),
    };
    const options = {
      attributes: { exclude: ['mot_de_passe'] },
      where,
      ...(inclure ? { include: inclure } : {}),
      order: [['createdAt', 'DESC']],
    };

    const paginee = page !== undefined || limit !== undefined;
    if (!paginee) {
      const lignes = await Utilisateur.findAll(options);
      return { [cle]: lignes, compteurs: await AdminService._compteursComptes(role) };
    }

    const p = paginate(page, limit);
    const { rows, count } = await Utilisateur.findAndCountAll({
      ...options,
      limit: p.limit,
      offset: p.offset,
      // Une jointure `hasMany` (les boutiques) ferait compter les lignes
      // jointes au lieu des comptes.
      distinct: true,
    });
    return {
      [cle]: rows,
      total: count,
      page: p.page,
      pages: Math.ceil(count / p.limit),
      compteurs: await AdminService._compteursComptes(role),
    };
  }

  // 1. Lister tous les vendeurs
  static async listerVendeur(filtres = {}) {
    try {
      const resultat = await AdminService._listerComptes({
        ...filtres,
        role: 'Vendeur',
        cle: 'vendeurs',
        // La boutique et l'état de son site : l'admin peut l'activer d'ici.
        inclure: [{
          model: Boutique, as: 'boutiques', required: false,
          attributes: ['id', 'nom', 'slug', 'statut', 'vitrineActive', 'vitrineConfiguree'],
        }],
      });

      return { message: 'Liste des vendeurs', ...resultat };

    } catch (error) {
      logger.error('Erreur listerVendeur', { message: error.message });
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
      logger.error('Erreur listerProduitsActifs', { message: error.message });
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
  static async listerClients(filtres = {}) {
    try {
      const resultat = await AdminService._listerComptes({
        ...filtres,
        role: 'Acheteur',
        cle: 'clients',
      });

      return { message: 'Liste des clients', ...resultat };

    } catch (error) {
      logger.error('Erreur listerClients', { message: error.message });
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

  /**
   * Prévient quelqu'un d'une décision de l'administration.
   *
   * Toutes ces décisions se prenaient en silence : un produit retiré, un
   * compte suspendu, un site coupé. La personne le découvrait en butant
   * dessus, sans savoir ce qui s'était passé ni quoi faire. Un échec d'envoi
   * ne remet jamais la décision en cause — elle est déjà enregistrée.
   */
  static _prevenir(utilisateurId, titre, message, data = {}) {
    if (!utilisateurId) return;
    require('../notifications/notification.service').creerNotification({
      utilisateurId, titre, message, type: 'systeme', data,
    }).catch((err) => logger.warn('[admin] notification non envoyée', {
      utilisateur: utilisateurId, titre, message: err.message,
    }));
  }

  // 8. Suspendre un vendeur
  static async suspendreVendeur(vendeurId) {
    const vendeur = await Utilisateur.findOne({ where: { id: vendeurId, role: 'Vendeur' } });
    if (!vendeur) throw new NotFoundError('Vendeur introuvable');
    await vendeur.update({ statut: 'inactif' });
    // Il ne pourra plus se connecter : s'il l'apprend en butant sur un refus
    // de connexion, il n'a aucun moyen de savoir pourquoi.
    AdminService._prevenir(
      vendeurId,
      'Compte suspendu',
      'Votre compte a été suspendu par l\'équipe SaamBiz. Contactez le support pour en connaître la raison.',
    );
    return { message: 'Vendeur suspendu avec succès' };
  }

  // 9. Activer un vendeur
  static async activerVendeur(vendeurId) {
    const vendeur = await Utilisateur.findOne({ where: { id: vendeurId, role: 'Vendeur' } });
    if (!vendeur) throw new NotFoundError('Vendeur introuvable');
    await vendeur.update({ statut: 'actif' });
    AdminService._prevenir(
      vendeurId,
      'Compte réactivé',
      'Votre compte est de nouveau actif. Vous pouvez vendre comme avant.',
    );
    return { message: 'Vendeur activé avec succès' };
  }

  // 10. Suspendre un acheteur
  static async suspendreAcheteur(acheteurId) {
    const acheteur = await Utilisateur.findOne({ where: { id: acheteurId, role: 'Acheteur' } });
    if (!acheteur) throw new NotFoundError('Acheteur introuvable');
    await acheteur.update({ statut: 'inactif' });
    AdminService._prevenir(
      acheteurId,
      'Compte suspendu',
      'Votre compte a été suspendu par l\'équipe SaamBiz. Contactez le support pour en connaître la raison.',
    );
    return { message: 'Acheteur suspendu avec succès' };
  }

  // 11. Lister les abonnements
  //
  // `statut` était reçu par la route et jeté ici : le back-office envoyait
  // bien `?statut=actif`, cette méthode ne prenait aucun argument, et le
  // filtre de l'écran ne changeait donc rien à la liste affichée.
  static async getAbonnements({ statut, recherche, page, limit } = {}) {
    const where = {};
    if (statut) {
      if (!STATUTS_ABONNEMENT.includes(statut)) {
        throw new BadRequestError(
          `Statut d'abonnement inconnu : ${statut}. Attendu : ${STATUTS_ABONNEMENT.join(', ')}.`
        );
      }
      where.statut = statut;
    }

    // La recherche porte sur le vendeur abonné : c'est ainsi qu'on cherche
    // un abonnement, pas par son identifiant.
    const terme = String(recherche || '').trim();
    if (terme) {
      const motif = `%${terme.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where[Op.or] = [
        { '$utilisateur.nom$': { [Op.iLike]: motif } },
        { '$utilisateur.prenom$': { [Op.iLike]: motif } },
        { '$utilisateur.email$': { [Op.iLike]: motif } },
      ];
    }

    const include = [{
      model: Utilisateur, as: 'utilisateur',
      attributes: { exclude: ['mot_de_passe'] },
    }];

    // Effectifs par état, comptés sur toute la table : les pastilles de
    // filtre annonceraient sinon ceux de la page affichée.
    const compteurs = await AdminService._compteursAbonnements();

    // Sans `page` ni `limit`, la liste entière est renvoyée comme avant.
    if (page === undefined && limit === undefined) {
      const abonnements = await Abonnement.findAll({
        where, include, order: [['createdAt', 'DESC']], subQuery: false,
      });
      return { message: 'Liste des abonnements', abonnements, compteurs };
    }

    const p = paginate(page, limit);
    const { rows, count } = await Abonnement.findAndCountAll({
      where, include,
      order: [['createdAt', 'DESC']],
      limit: p.limit,
      offset: p.offset,
      subQuery: false,
      distinct: true,
    });
    return {
      message: 'Liste des abonnements',
      abonnements: rows,
      total: count,
      page: p.page,
      pages: Math.ceil(count / p.limit),
      compteurs,
    };
  }

  /** Combien d'abonnements dans chacun des trois états. */
  static async _compteursAbonnements() {
    const [tous, ...parStatut] = await Promise.all([
      Abonnement.count(),
      ...STATUTS_ABONNEMENT.map((s) => Abonnement.count({ where: { statut: s } })),
    ]);
    return Object.fromEntries([
      ['', tous],
      ...STATUTS_ABONNEMENT.map((s, i) => [s, parStatut[i]]),
    ]);
  }

  // 13. Approuver un produit
  static async approuverProduit(produitId) {
    const produit = await Produit.findByPk(produitId);
    if (!produit) throw new NotFoundError('Produit introuvable');
    await produit.update({ statut: 'approuve' });
    AdminService._prevenir(
      produit.vendeurId,
      'Produit approuvé',
      `« ${produit.nom} » est validé : il est maintenant visible par les clients.`,
      { ecran: 'mes_produits', produitId: produit.id, pourVendeur: true },
    );
    return { message: 'Produit approuvé avec succès' };
  }

  // 14. Rejeter un produit
  static async rejeterProduit(produitId) {
    const produit = await Produit.findByPk(produitId);
    if (!produit) throw new NotFoundError('Produit introuvable');
    await produit.update({ statut: 'rejete' });
    // Sans ce mot, le produit disparaissait de la boutique sans explication :
    // le vendeur le croyait en ligne et attendait des ventes qui ne
    // viendraient jamais.
    AdminService._prevenir(
      produit.vendeurId,
      'Produit refusé',
      `« ${produit.nom} » n'a pas été validé et n'est plus proposé aux clients. `
        + 'Corrigez sa fiche puis soumettez-la à nouveau.',
      { ecran: 'mes_produits', produitId: produit.id, pourVendeur: true },
    );
    return { message: 'Produit rejeté avec succès' };
  }

  // 15. Supprimer un produit
  static async supprimerProduit(produitId) {
    const produit = await Produit.findByPk(produitId);
    if (!produit) throw new NotFoundError('Produit introuvable');
    await produit.destroy({ force: true });
    return { message: 'Produit supprimé avec succès' };
  }

  // 15 bis. Activer / désactiver le site web (vitrine) d'une boutique
  static async basculerSiteBoutique(boutiqueId, active) {
    const boutique = await Boutique.findByPk(boutiqueId);
    if (!boutique) throw new NotFoundError('Boutique introuvable');
    const maj = { vitrineActive: Boolean(active) };
    if (maj.vitrineActive) {
      // Une boutique créée avant les sites peut n'avoir aucune adresse.
      if (!boutique.slug) {
        const { genererSlugUnique } = require('../../utils/boutiqueDefaults');
        maj.slug = await genererSlugUnique(boutique.nom);
      }
      // Un site doit avoir été personnalisé une première fois par son
      // vendeur (mise en page, couleur, textes) avant d'être publié.
      if (!boutique.vitrineConfiguree) {
        throw new BadRequestError("Le vendeur doit d'abord personnaliser son site depuis son espace (« Mon site ») avant qu'il soit publié.");
      }
    }
    await boutique.update(maj);
    const base = (process.env.VITRINE_BASE_URL || 'https://saambiz.com').replace(/\/+$/, '');
    // Le vendeur partage l'adresse de son site sur WhatsApp et l'imprime sur
    // ses cartes : qu'elle cesse de répondre sans qu'on le lui dise est le
    // genre de silence qui se paie en clients perdus.
    AdminService._prevenir(
      boutique.vendeurId,
      maj.vitrineActive ? 'Votre site est en ligne' : 'Votre site est hors ligne',
      maj.vitrineActive
        ? `Le site de ${boutique.nom} est publié : ${base}/b/${boutique.slug}`
        : `Le site de ${boutique.nom} a été désactivé par l'équipe SaamBiz. Contactez le support pour en connaître la raison.`,
      { ecran: 'ma_boutique', pourVendeur: true },
    );
    return {
      message: maj.vitrineActive ? 'Site activé' : 'Site désactivé',
      boutique: {
        id: boutique.id, nom: boutique.nom, slug: boutique.slug,
        vitrineActive: boutique.vitrineActive, url: `${base}/b/${boutique.slug}`,
      },
    };
  }

  // 15 ter. Supprimer le site web d'une boutique (pas ses produits)
  static async supprimerSiteBoutique(boutiqueId) {
    const boutique = await Boutique.findByPk(boutiqueId);
    if (!boutique) throw new NotFoundError('Boutique introuvable');
    await boutique.update(Boutique.reglagesSiteParDefaut());
    return { message: 'Site supprimé — les produits restent dans l’application', boutique: { id: boutique.id, nom: boutique.nom } };
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
        'pieceIdentite', 'pieceIdentiteVerso', 'typePiece', 'dateSoumission', 'createdAt',
      ],
      include: [{
        model: Boutique,
        as: 'boutiques',
        attributes: ['id', 'nom', 'categorie', 'localisation', 'logo'],
        required: false,
      }],
      order: [['dateSoumission', 'ASC']],
    });
    // Pièces d'identité rangées dans le bucket PRIVÉ (« prive:<clé> ») : le
    // back-office reçoit un lien signé de dix minutes à leur place. Une
    // ancienne URL publique (Cloudinary) passe telle quelle.
    const lignes = await Promise.all(vendeurs.map(async (v) => {
      const ligne = typeof v.toJSON === 'function' ? v.toJSON() : { ...v };
      [ligne.pieceIdentite, ligne.pieceIdentiteVerso] = await Promise.all([
        urlLecture(ligne.pieceIdentite),
        urlLecture(ligne.pieceIdentiteVerso),
      ]);
      return ligne;
    }));
    return { message: 'Profils vendeurs en attente de validation', vendeurs: lignes };
  }

  /** E-mail de réponse à une demande de certification. Un échec d'envoi
   *  est journalisé, il n'annule pas la décision de l'administrateur. */
  static async _emailCertification(vendeur, approuvee, motif = null) {
    if (!vendeur.email) return;
    try {
      const boutique = await Boutique.findOne({ where: { vendeurId: vendeur.id }, attributes: ['nom'] });
      await sendCertificationEmail({
        to: vendeur.email,
        prenom: vendeur.prenom,
        boutique: boutique ? boutique.nom : null,
        approuvee,
        motif,
      });
    } catch (err) {
      logger.warn(`[certification] e-mail non envoyé à ${vendeur.email} : ${err.message}`);
    }
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

    // Le vendeur est prévenu dans l'application ET sur son téléphone :
    // `creerNotification` écrit la ligne, l'émet en temps réel et envoie le
    // push, les trois d'un coup. (Chargée ici : évite une dépendance
    // circulaire au démarrage.) Un échec d'envoi n'annule pas la décision.
    //
    // `certification` dans les données n'est pas décoratif : sans lui, la
    // notification ne portait aucun identifiant, et le téléphone la faisait
    // retomber sur la messagerie — le vendeur prévenu que sa boutique est
    // certifiée atterrissait dans ses conversations.
    require('../notifications/notification.service').creerNotification({
      utilisateurId: vendeurId,
      titre: 'Votre boutique est certifiée',
      message: 'Félicitations ! Le badge de certification s\'affiche maintenant sur votre boutique.',
      type: 'systeme',
      data: { certification: 'approuve' },
    }).catch(echecIgnore('notification certification approuvée'));
    AdminService._emailCertification(vendeur, true);

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

    // Même chose pour un refus — et c'est ici que l'écran visé compte le
    // plus : la notification dit « vous pouvez renvoyer vos photos », il faut
    // donc qu'un toucher mène à l'écran qui le permet.
    require('../notifications/notification.service').creerNotification({
      utilisateurId: vendeurId,
      titre: 'Certification refusée',
      message: `Motif : ${motif.trim()} Vous pouvez renvoyer vos photos depuis votre compte.`,
      type: 'systeme',
      data: { certification: 'rejete' },
    }).catch(echecIgnore('notification certification rejetée'));
    AdminService._emailCertification(vendeur, false, motif.trim());

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
    // « Mes signalements » affichait « en attente » indéfiniment, même des
    // mois après la décision : celui qui signale finissait par croire que
    // personne ne lisait.
    AdminService._prevenir(
      signalement.signaleurId,
      'Signalement traité',
      'Votre signalement a été examiné par l\'équipe SaamBiz et les mesures nécessaires ont été prises. Merci de nous avoir alertés.',
      { ecran: 'mes_signalements' },
    );
    return { message: 'Signalement marqué comme traité' };
  }

  // 20. Rejeter un signalement
  static async rejeterSignalement(signalementId) {
    const signalement = await Signalement.findByPk(signalementId);
    if (!signalement) throw new NotFoundError('Signalement introuvable');
    await signalement.update({ statut: 'rejete' });
    AdminService._prevenir(
      signalement.signaleurId,
      'Signalement examiné',
      'Votre signalement a été examiné : l\'équipe SaamBiz n\'a pas constaté de manquement aux règles. Merci tout de même de votre vigilance.',
      { ecran: 'mes_signalements' },
    );
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
  static async tousLesPaiements({ statut, recherche, page = 1, limit = 20 } = {}) {
    const where = {};
    if (statut) where.statut = statut;
    // Recherche sur ce qui identifie un paiement : sa référence, la
    // transaction de l'opérateur, le numéro appelé.
    Object.assign(where, AdminService._recherche(recherche, [
      'referencePaiement', 'transactionId', 'numeroTelephone',
    ]));
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
  static async paiementsEchoues({ recherche, page = 1, limit = 20 } = {}) {
    const p = paginate(page, limit);
    const { count, rows } = await Paiement.findAndCountAll({
      where: {
        statut: 'failed',
        ...AdminService._recherche(recherche, [
          'referencePaiement', 'transactionId', 'numeroTelephone',
        ]),
      },
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

  // adminId : l'auteur de l'opération, pour le journal d'audit
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

    // Audit trail
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

  /**
   * Retire un abonnement avant son terme.
   *
   * `revoque` et non `expire` : les deux se ressemblent — l'accès est coupé
   * dans les deux cas — mais ils ne disent pas la même chose. Un abonnement
   * expiré n'a pas été renouvelé ; un abonnement révoqué a été retiré par un
   * administrateur, et c'est une décision qu'on doit pouvoir retrouver.
   * Confondus, le back-office ne pouvait plus dire lequel des deux s'était
   * produit.
   */
  static async revoquerAbonnement(abonnementId) {
    const abonnement = await Abonnement.findByPk(abonnementId);
    if (!abonnement) throw new NotFoundError('Abonnement introuvable');
    await abonnement.update({ statut: 'revoque' });
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

  /**
   * Clause de recherche sur plusieurs colonnes, ou `{}` si rien n'est cherché.
   *
   * Ces listes paginées n'acceptaient aucun terme de recherche : le
   * back-office filtrait donc dans la page affichée, dix lignes, tout en
   * laissant croire qu'il cherchait dans l'historique entier. Chercher une
   * commande qu'on ne trouvait pas revenait à conclure qu'elle n'existait pas.
   *
   * `iLike` : la casse ne compte pas — on cherche « diop » comme « DIOP ».
   * Les caractères `%` et `_` saisis par l'utilisateur sont échappés, sinon
   * « 100% » ramènerait toute la table.
   */
  static _recherche(recherche, champs) {
    const terme = String(recherche || '').trim();
    if (!terme) return {};
    const motif = `%${terme.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return { [Op.or]: champs.map((champ) => ({ [champ]: { [Op.iLike]: motif } })) };
  }

  // Liste paginée de toutes les commandes (filtrable par statut et recherche)
  static async toutesLesCommandes({ statut, boutiqueId, recherche, page = 1, limit = 20 } = {}) {
    const where = {};
    if (statut) where.statut = statut;
    if (boutiqueId) {
      const boutique = await Boutique.findByPk(boutiqueId, { attributes: ['vendeurId'] });
      if (!boutique) throw new NotFoundError('Boutique introuvable');
      where.vendeurId = boutique.vendeurId;
    }
    // La recherche porte sur la commande elle-même : sa référence et le
    // client saisi quand il n'a pas de compte.
    Object.assign(where, AdminService._recherche(recherche, [
      'referenceCommande', 'clientNom', 'clientPrenom', 'clientTelephone',
    ]));

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
    // `statutPaiement` (l'attribut du modèle) et non `statut_paiement` (la
    // colonne) : Sequelize laisse passer une clé inconnue comme référence
    // brute, si bien que les deux visaient la même colonne — par chance. Le
    // comptage juste en dessous employait déjà l'attribut ; l'écart aurait
    // cessé d'être sans conséquence le jour où un attribut se serait appelé
    // `statut_paiement`.
    const caRow = await Commande.findOne({
      attributes: [[fn('COALESCE', fn('SUM', col('montant_total')), 0), 'ca']],
      where: { statutPaiement: 'paye' },
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