const { Produit, Categorie, Boutique, Abonnement, Message, Paiement, Favori, Utilisateur, ProduitImage, Commande } = require('../../models');
const { uploadImage, deleteImage } = require('../../middlewares/uploadService');
const sequelize = require('../../config/db');
const NotificationService = require('../notifications/notification.service');
const { appliquerDefautsBoutique, genererSlugUnique } = require('../../utils/boutiqueDefaults');
const { Op, fn, col } = require('sequelize');
const { BadRequestError, ConflictError, NotFoundError } = require('../../errors/AppError');

const DEFAULT_PAGE_SIZE = 20;

// Mises en page proposées pour la vitrine — la liste du service fait foi.
const { MODELES_VITRINE } = require('../vitrine/vitrine.service');

// Domaine qui sert les vitrines. Le vendeur voit l'adresse de son site dans
// son tableau de bord, la partage sur WhatsApp et l'imprime sur ses cartes :
// elle ne peut pas dépendre du navigateur qui affiche la page.
const VITRINE_BASE_URL = (process.env.VITRINE_BASE_URL || 'https://saambiz.com').replace(/\/+$/, '');

// Chemins du site principal qu'une boutique ne doit pas pouvoir masquer.
const SLUGS_RESERVES = [
  'b', 'api', 'admin', 'vendeur', 'boutique', 'boutiques', 'compte', 'panier',
  'commande', 'commandes', 'suivi', 'connexion', 'inscription', 'abonnement',
  'contact', 'aide', 'cgu', 'cgv', 'confidentialite', 'app', 'assets', 'static',
];

function paginate(page = 1, limit = DEFAULT_PAGE_SIZE) {
  return {
    limit: parseInt(limit),
    offset: (parseInt(page) - 1) * parseInt(limit),
  };
}

// Champs modifiables sur un Produit — HIGH-01 whitelist
const PRODUIT_FIELDS = ['nom', 'description', 'prix', 'prix_promo', 'quantite', 'categorieId', 'marque', 'attributs', 'disponible'];

// Champs modifiables sur une Boutique — HIGH-01 whitelist
const BOUTIQUE_FIELDS = ['nom', 'slug', 'description', 'slogan', 'localisation', 'telephone', 'whatsapp', 'ville', 'latitude', 'longitude', 'banniere', 'couleur_theme', 'categorie'];

class VendeurService {

  // -------------------- LISTER PRODUITS --------------------
  // HIGH-02 : pagination ajoutée
  static async listerProduits(vendeurId, { page = 1, limit = DEFAULT_PAGE_SIZE } = {}) {
    const { limit: l, offset } = paginate(page, limit);
    const { rows, count } = await Produit.findAndCountAll({
      where: { vendeurId },
      include: [
        { model: Categorie, as: 'categorie', attributes: ['id', 'nom'] },
        { model: ProduitImage, as: 'images', attributes: ['id', 'url', 'ordre'] },
      ],
      limit: l,
      offset,
      order: [['createdAt', 'DESC']]
    });
    return { produits: rows, total: count, page: parseInt(page), pages: Math.ceil(count / l) };
  }

  // -------------------- AJOUTER PRODUIT --------------------
  static async ajouterProduit(vendeurId, {
    nom, description, prix, prix_promo, quantite, categorieId,
    image, marque, attributs, disponible, nomVendeur
  }) {
    const t = await sequelize.transaction();
    try {
      let imageUrl = null;
      if (image?.buffer) imageUrl = await uploadImage(image.buffer);

      // attributs peut arriver en JSON string via multipart/form-data
      let attributsParsed = attributs;
      if (typeof attributs === 'string' && attributs.trim()) {
        try { attributsParsed = JSON.parse(attributs); } catch { attributsParsed = null; }
      }

      const produit = await Produit.create({
        nom, description, prix, prix_promo: prix_promo || null,
        quantite, image: imageUrl,
        vendeurId, categorieId, marque, attributs: attributsParsed, disponible
      }, { transaction: t });

      await t.commit();

      // Notifie uniquement les abonnés des boutiques du vendeur ayant activé la cloche.
      NotificationService.notifierAbonnesDuVendeur(
        vendeurId,
        `Nouveau produit : ${nom}`,
        `${nomVendeur || 'Votre boutique'} vient de publier "${nom}"`,
        'nouveau_produit'
      ).catch(() => {});

      return produit;
    } catch (err) {
      await t.rollback();
      throw err;
    }
  }

  // -------------------- MODIFIER PRODUIT --------------------
  // HIGH-01 : whitelist stricte des champs modifiables
  static async modifierProduit(vendeurId, produitId, updates) {
    const t = await sequelize.transaction();
    try {
      const produit = await Produit.findOne({
        where: { id: produitId, vendeurId },
        transaction: t
      });

      if (!produit) throw new NotFoundError("Produit introuvable ou accès interdit");

      // Construire un objet avec uniquement les champs autorisés
      const safeUpdates = {};
      for (const field of PRODUIT_FIELDS) {
        if (updates[field] !== undefined) safeUpdates[field] = updates[field];
      }

      // Upload image si fournie (vient du middleware multer, pas du body)
      if (updates.image?.buffer) {
        safeUpdates.image = await uploadImage(updates.image.buffer);
      }

      await produit.update(safeUpdates, { transaction: t });
      await t.commit();

      return produit;
    } catch (err) {
      await t.rollback();
      throw err;
    }
  }

  // -------------------- SUPPRIMER PRODUIT --------------------
  static async supprimerProduit(vendeurId, produitId) {
    const t = await sequelize.transaction();
    try {
      const produit = await Produit.findOne({ where: { id: produitId, vendeurId }, transaction: t });
      if (!produit) throw new NotFoundError("Produit introuvable ou accès interdit");

      await produit.destroy({ transaction: t });
      await t.commit();

      return { success: true, message: "Produit supprimé avec succès" };
    } catch (err) {
      await t.rollback();
      throw err;
    }
  }

  // -------------------- NOMBRE DE PRODUITS PAR CATEGORIE --------------------
  static async getProduitsParCategorie(vendeurId) {
    const result = await Produit.findAll({
      where: { vendeurId },
      attributes: [
        'categorieId',
        [sequelize.fn('COUNT', sequelize.col('"Produit"."id"')), 'nombreProduits']
      ],
      include: [{ model: Categorie, as: 'categorie', attributes: ['id', 'nom'] }],
      group: ['Produit.categorie_id', 'categorie.id', 'categorie.nom']
    });
    return result.map(r => ({
      categorieNom: r.categorie?.nom || null,
      nombreProduits: parseInt(r.get('nombreProduits'))
    }));
  }

  // -------------------- NOMBRE TOTAL DE PRODUITS --------------------
  static async getNombreProduits(vendeurId) {
    const nombreProduits = await Produit.count({ where: { vendeurId } });
    return { nombreProduits };
  }

  // -------------------- MA BOUTIQUE --------------------
  static async maBoutique(vendeurId) {
    const boutique = await Boutique.findOne({
      where: { vendeurId },
      include: [
        { model: Produit, as: 'produits', attributes: ['id', 'nom', 'prix', 'prix_promo', 'image', 'disponible', 'vues', 'statut'] }
      ]
    });
    if (!boutique) throw new NotFoundError('Boutique introuvable');
    const totalVues = boutique.produits.reduce((acc, p) => acc + (p.vues || 0), 0);
    return { boutique, stats: { totalVues, nombreProduits: boutique.produits.length } };
  }

  // -------------------- CRÉER BOUTIQUE --------------------
  static async creerBoutique(vendeurId, data, files = {}) {
    const existante = await Boutique.findOne({ where: { vendeurId } });
    if (existante) throw new ConflictError('Vous avez déjà une boutique');

    // HIGH-01 : whitelist champs boutique
    let safeData = {};
    for (const field of BOUTIQUE_FIELDS) {
      if (data[field] !== undefined) safeData[field] = data[field];
    }

    // Uploads logo & bannière
    if (files.logo?.buffer) safeData.logo = await uploadImage(files.logo.buffer);
    if (files.banniere?.buffer) safeData.banniere = await uploadImage(files.banniere.buffer);

    // Modèle de boutique par défaut (cohérence quel que soit le type de vendeur)
    safeData = appliquerDefautsBoutique(safeData);
    if (!safeData.slug) safeData.slug = await genererSlugUnique(safeData.nom);

    const boutique = await Boutique.create({ ...safeData, vendeurId });
    return { boutique };
  }

  // -------------------- MODIFIER BOUTIQUE --------------------
  // HIGH-01 : whitelist stricte des champs modifiables
  static async modifierBoutique(vendeurId, data, files = {}) {
    const boutique = await Boutique.findOne({ where: { vendeurId } });
    if (!boutique) throw new NotFoundError('Boutique introuvable');

    const safeData = {};
    for (const field of BOUTIQUE_FIELDS) {
      if (data[field] !== undefined) safeData[field] = data[field];
    }

    if (files.logo?.buffer) safeData.logo = await uploadImage(files.logo.buffer);
    if (files.banniere?.buffer) safeData.banniere = await uploadImage(files.banniere.buffer);

    await boutique.update(safeData);
    return { boutique };
  }

  // ══════════════════════════════════════════════════════════════════
  //  VITRINE — le site web public de la boutique
  // ══════════════════════════════════════════════════════════════════
  //
  //  Le vendeur ne choisit pas un site entier parmi des maquettes : il règle
  //  un moteur unique. Trois mises en page, une couleur d'accent, des
  //  sections qu'on allume ou qu'on éteint. Une seule base de code à tenir,
  //  une qualité identique pour tous, et un vendeur qui gère sa boutique
  //  depuis son téléphone n'a pas à comparer des templates pour ouvrir son
  //  site.

  /** Réglages actuels + adresse publique, pour l'écran de personnalisation. */
  static async maVitrine(vendeurId) {
    const boutique = await Boutique.findOne({ where: { vendeurId } });
    if (!boutique) {
      throw new NotFoundError("Créez d'abord votre boutique pour ouvrir votre site.");
    }

    // Une boutique d'avant la vitrine peut n'avoir aucun slug si sa création
    // a précédé la migration. On lui en fabrique un à la première ouverture
    // de cet écran plutôt que de renvoyer un site sans adresse.
    if (!boutique.slug) {
      await boutique.update({ slug: await genererSlugUnique(boutique.nom) });
    }

    const nombreProduits = await Produit.count({
      where: { vendeurId, statut: 'approuve' },
    });

    return {
      vitrine: {
        slug: boutique.slug,
        // L'adresse complète est calculée ici et non dans le front : le
        // dashboard et l'application afficheraient sinon deux domaines
        // différents selon leur configuration.
        url: `${VITRINE_BASE_URL}/b/${boutique.slug}`,
        active: boutique.vitrineActive !== false,
        modele: MODELES_VITRINE.includes(boutique.vitrineModele) ? boutique.vitrineModele : 'classique',
        accent: boutique.vitrineAccent || boutique.couleur_theme || '#0D1B3D',
        apropos: boutique.vitrineApropos,
        annonce: boutique.vitrineAnnonce,
        horaires: boutique.vitrineHoraires,
        reseaux: boutique.vitrineReseaux || {},
        sections: {
          apropos:    boutique.vitrineSections?.apropos    !== false,
          categories: boutique.vitrineSections?.categories !== false,
          avis:       boutique.vitrineSections?.avis       !== false,
          contact:    boutique.vitrineSections?.contact    !== false,
        },
        commande: boutique.vitrineCommande !== false,
        paiementLivraison: boutique.vitrinePaiementLivraison !== false,
        vues: boutique.vitrineVues || 0,

        // Distinct de `active` : « configurée » dit que le vendeur est passé
        // par l'assistant de l'application mobile. Le tableau de bord web s'y
        // fie pour renvoyer vers l'application plutôt que d'afficher un
        // formulaire de réglages sur un site qui n'existe pas encore.
        configuree: boutique.vitrineConfiguree === true,
        creeeLe: boutique.vitrineCreeeLe,
        secteur: boutique.vitrineSecteur,
        activite: boutique.vitrineActivite,
        logoForme: boutique.vitrineLogoForme || 'libre',
        // Les couleurs relevées dans le logo, pour que le vendeur retrouve
        // ses choix sans re-téléverser son fichier.
        palette: boutique.vitrinePalette || [],
      },
      // Rappelés ici parce que l'écran de personnalisation en montre l'aperçu.
      boutique: {
        nom: boutique.nom,
        slogan: boutique.slogan,
        logo: boutique.logo,
        banniere: boutique.banniere,
        ville: boutique.ville,
        telephone: boutique.telephone,
        whatsapp: boutique.whatsapp,
      },
      // Un site sans produit ne sert à rien : l'écran doit pouvoir le dire.
      nombreProduits,
      modelesDisponibles: MODELES_VITRINE,
    };
  }

  /**
   * Enregistre les réglages de la vitrine.
   *
   * Tout est validé ici plutôt que dans un schéma Joi : les valeurs sont peu
   * nombreuses, très typées, et le message d'erreur doit rester lisible par
   * un vendeur — « Cette adresse est déjà prise » et non « slug must match
   * pattern ».
   */
  static async majVitrine(vendeurId, data = {}) {
    const boutique = await Boutique.findOne({ where: { vendeurId } });
    if (!boutique) {
      throw new NotFoundError("Créez d'abord votre boutique pour ouvrir votre site.");
    }

    const maj = {};

    // ── Adresse du site ──────────────────────────────────────────────
    // Le slug est l'adresse que le vendeur imprime sur ses cartes et colle
    // sur sa devanture. Il peut la changer, mais elle doit rester une URL
    // valide et libre.
    if (data.slug !== undefined) {
      const slug = String(data.slug || '').trim().toLowerCase();
      if (!/^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/.test(slug)) {
        throw new BadRequestError(
          "L'adresse doit faire entre 3 et 60 caractères : lettres sans accent, chiffres et tirets."
        );
      }
      // Les mots réservés protègent les chemins du site principal : une
      // boutique nommée « abonnement » masquerait la page d'abonnement.
      if (SLUGS_RESERVES.includes(slug)) {
        throw new BadRequestError('Cette adresse est réservée, choisissez-en une autre.');
      }
      if (slug !== boutique.slug) {
        const pris = await Boutique.findOne({ where: { slug }, paranoid: false });
        if (pris) throw new ConflictError('Cette adresse est déjà prise par une autre boutique.');
        maj.slug = slug;
      }
    }

    // ── Apparence ────────────────────────────────────────────────────
    if (data.modele !== undefined) {
      if (!MODELES_VITRINE.includes(data.modele)) {
        throw new BadRequestError('Mise en page inconnue.');
      }
      maj.vitrineModele = data.modele;
    }

    if (data.accent !== undefined) {
      const accent = String(data.accent || '').trim();
      if (accent && !/^#[0-9a-fA-F]{6}$/.test(accent)) {
        throw new BadRequestError('La couleur doit être au format #RRGGBB.');
      }
      maj.vitrineAccent = accent || null;
    }

    // ── Contenus ─────────────────────────────────────────────────────
    if (data.apropos !== undefined) {
      maj.vitrineApropos = String(data.apropos || '').trim().slice(0, 2000) || null;
    }
    if (data.annonce !== undefined) {
      maj.vitrineAnnonce = String(data.annonce || '').trim().slice(0, 180) || null;
    }
    if (data.horaires !== undefined) {
      maj.vitrineHoraires = String(data.horaires || '').trim().slice(0, 160) || null;
    }

    // ── Réseaux sociaux ──────────────────────────────────────────────
    // Seules quatre clés connues sont retenues, et seulement en http(s) :
    // ces valeurs finissent dans un href sur une page publique, un
    // `javascript:` recopié tel quel y deviendrait exécutable.
    if (data.reseaux !== undefined) {
      const source = data.reseaux || {};
      const reseaux = {};
      for (const cle of ['facebook', 'instagram', 'tiktok', 'site']) {
        const val = String(source[cle] || '').trim().slice(0, 200);
        if (!val) continue;
        if (!/^https?:\/\//i.test(val)) {
          throw new BadRequestError(`Le lien ${cle} doit commencer par https://`);
        }
        reseaux[cle] = val;
      }
      maj.vitrineReseaux = Object.keys(reseaux).length ? reseaux : null;
    }

    // ── Sections affichées ───────────────────────────────────────────
    if (data.sections !== undefined) {
      const s = data.sections || {};
      maj.vitrineSections = {
        apropos:    s.apropos    !== false,
        categories: s.categories !== false,
        avis:       s.avis       !== false,
        contact:    s.contact    !== false,
      };
    }

    // ── Publication et caisse ────────────────────────────────────────
    if (data.active !== undefined) maj.vitrineActive = !!data.active;
    if (data.commande !== undefined) maj.vitrineCommande = !!data.commande;
    if (data.paiementLivraison !== undefined) maj.vitrinePaiementLivraison = !!data.paiementLivraison;

    await boutique.update(maj);
    return await VendeurService.maVitrine(vendeurId);
  }

  // -------------------- MON ABONNEMENT --------------------
  static async monAbonnement(vendeurId) {
    const abonnement = await Abonnement.findOne({
      where: { utilisateurId: vendeurId },
      order: [['createdAt', 'DESC']],
    });
    if (!abonnement) throw new NotFoundError('Aucun abonnement trouvé');

    const now = new Date();
    const fin = new Date(abonnement.dateFin);
    const joursRestants = Math.max(0, Math.ceil((fin - now) / (1000 * 60 * 60 * 24)));

    return { abonnement, joursRestants };
  }

  // -------------------- INITIER RENOUVELLEMENT --------------------
  static async initierRenouvellement(vendeurId) {
    const abonnement = await Abonnement.findOne({
      where: { utilisateurId: vendeurId },
      order: [['createdAt', 'DESC']],
    });

    const now = new Date();
    if (abonnement) {
      const fin = new Date(abonnement.dateFin);
      const joursRestants = Math.ceil((fin - now) / (1000 * 60 * 60 * 24));
      if (joursRestants > 7) throw new BadRequestError('Votre abonnement est encore actif (plus de 7 jours restants)');
    }

    return { montant: 2000, devise: 'FCFA', vendeurId, description: 'Renouvellement abonnement Jëndal' };
  }

  // -------------------- STATISTIQUES VUES --------------------
  // HIGH-02 : pagination
  static async statistiquesVues(vendeurId, { page = 1, limit = DEFAULT_PAGE_SIZE } = {}) {
    const { limit: l, offset } = paginate(page, limit);
    const { rows, count } = await Produit.findAndCountAll({
      where: { vendeurId },
      attributes: ['id', 'nom', 'vues'],
      limit: l,
      offset,
      order: [['vues', 'DESC']]
    });
    const totalVues = rows.reduce((acc, p) => acc + (p.vues || 0), 0);
    return { produits: rows, totalVues, total: count, page: parseInt(page), pages: Math.ceil(count / l) };
  }

  // -------------------- DASHBOARD --------------------
  // ==============================
  // VÉRIFICATION DU PROFIL VENDEUR
  // ==============================
  // Distincte de la confirmation d'email : ici le vendeur transmet une pièce
  // justificative qu'un administrateur examine. Tant que le profil n'est pas
  // approuvé, la boutique reste visible mais sans le badge de confiance.
  static async soumettreVerification(vendeurId, { fichier, typePiece }) {
    const vendeur = await Utilisateur.findOne({ where: { id: vendeurId, role: 'Vendeur' } });
    if (!vendeur) return { success: false, message: 'Vendeur introuvable' };

    if (vendeur.statutValidation === 'approuve') {
      return { success: false, message: 'Votre profil est déjà validé.' };
    }
    if (vendeur.statutValidation === 'en_attente') {
      return { success: false, message: "Votre demande est déjà en cours d'examen." };
    }
    if (!fichier) {
      return { success: false, message: 'La pièce justificative est requise.' };
    }

    // Même stockage que les logos et photos produits (buffer multer).
    const pieceUrl = await uploadImage(fichier.buffer);

    await vendeur.update({
      pieceIdentite: pieceUrl,
      typePiece: typePiece || null,
      statutValidation: 'en_attente',
      dateSoumission: new Date(),
      motifRejet: null,
    });

    return { success: true, message: "Demande envoyée. Un administrateur l'examine sous 48 h." };
  }

  static async statutVerification(vendeurId) {
    const vendeur = await Utilisateur.findByPk(vendeurId, {
      attributes: ['statutValidation', 'typePiece', 'motifRejet', 'dateSoumission', 'dateValidation'],
    });
    if (!vendeur) return { success: false, message: 'Vendeur introuvable' };
    return { success: true, verification: vendeur };
  }

  static async dashboard(vendeurId) {
    const [boutique, abonnementRaw, messagesNonLus, notifsNonLues, topProduits] = await Promise.all([
      Boutique.findOne({
        where: { vendeurId },
        attributes: ['id', 'nom', 'logo', 'localisation', 'whatsapp']
      }),
      Abonnement.findOne({
        where: { utilisateurId: vendeurId },
        order: [['createdAt', 'DESC']]
      }),
      Message.count({ where: { destinataireId: vendeurId, lu: false } }),
      // `notification` ne declare pas `underscored` : sa colonne est restee en
      // camelCase. En SQL brut il faut la CITER, sinon PostgreSQL la met en
      // minuscules, ne la trouve pas, et tout le tableau de bord tombe en 400.
      // Voir « Quatre tables ont des colonnes en camelCase » dans CLAUDE.md.
      sequelize.query(
        `SELECT COUNT(*) FROM notification WHERE "utilisateurId" = :uid AND lue = false`,
        { replacements: { uid: vendeurId }, type: sequelize.QueryTypes.SELECT }
      ),
      Produit.findAll({
        where: { vendeurId },
        attributes: ['id', 'nom', 'vues', 'prix', 'image'],
        order: [['vues', 'DESC']],
        limit: 5
      }),
    ]);

    let totalVues = 0;
    let nombreProduits = 0;

    if (boutique) {
      const [produitStats, favoriCount] = await Promise.all([
        Produit.findAll({ where: { vendeurId }, attributes: ['vues'] }),
        Favori.count({ where: { boutiqueId: boutique.id } })
      ]);

      totalVues = produitStats.reduce((acc, p) => acc + (p.vues || 0), 0);
      nombreProduits = produitStats.length;

      boutique.dataValues.nombreFavoris = favoriCount;
    }

    const joursRestants = abonnementRaw
      ? Math.max(0, Math.ceil((new Date(abonnementRaw.dateFin) - new Date()) / (1000 * 60 * 60 * 24)))
      : 0;

    const notifsCount = notifsNonLues[0]?.count || 0;

    // ---- Ventes : chiffre d'affaires, commandes, revenus des 7 derniers jours ----
    const [ventes, canaux] = await Promise.all([
      this._statsVentes(vendeurId),
      this.canauxEtConversion(vendeurId),
    ]);

    return {
      boutique,
      abonnement: abonnementRaw ? {
        statut: abonnementRaw.statut,
        type: abonnementRaw.type,
        dateFin: abonnementRaw.dateFin,
        joursRestants
      } : null,
      stats: {
        totalVues,
        nombreProduits,
        nombreAbonnes: boutique ? boutique.dataValues.nombreFavoris : 0,
        chiffreAffaires: ventes.chiffreAffaires,
        nombreCommandes: ventes.nombreCommandes,
        commandesEnAttente: ventes.commandesEnAttente,
      },
      revenus7Jours: ventes.revenus7Jours,
      // D'où viennent les commandes, et combien de clients du site le vendeur
      // peut joindre dans l'application.
      canaux: canaux.canaux,
      conversion: canaux.conversion,
      messagesNonLus,
      notificationsNonLues: parseInt(notifsCount),
      topProduits,
    };
  }

  /**
   * D'où viennent les commandes, et combien de clients du site le vendeur
   * peut-il joindre dans l'application.
   *
   * Deux questions que le vendeur se pose vraiment :
   *
   *   1. « Mon site me rapporte-t-il quelque chose ? » — les commandes sont
   *      donc ventilées par canal, avec le chiffre d'affaires de chacun.
   *
   *   2. « Puis-je prévenir ces clients de mes arrivages ? » — non, tant
   *      qu'ils n'ont pas l'application. Un client qui commande sur le site
   *      ne crée pas de compte : il laisse un nom et un numéro, et c'est
   *      tout. Le vendeur ne peut ni lui envoyer de notification, ni le voir
   *      dans ses abonnés. Le taux de conversion mesure exactement cet écart.
   *
   * Le rapprochement se fait sur les NEUF DERNIERS CHIFFRES du numéro. Le site
   * normalise en +221…, l'inscription dans l'application accepte ce que le
   * vendeur a tapé : comparer les chaînes brutes raterait la moitié des
   * correspondances.
   */
  static async canauxEtConversion(vendeurId) {
    const PAYEES = "(c.statut_paiement = 'paye' OR c.statut = 'livree')";

    const [canaux, conversion] = await Promise.all([
      sequelize.query(
        `SELECT c.origine,
                COUNT(*)::int AS commandes,
                COALESCE(SUM(c.montant_total) FILTER (WHERE ${PAYEES}), 0) AS chiffre_affaires
           FROM commande c
          WHERE c.vendeur_id = :vendeurId
          GROUP BY c.origine`,
        { replacements: { vendeurId }, type: sequelize.QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT
            COUNT(DISTINCT t.numero)::int AS clients,
            COUNT(DISTINCT t.numero) FILTER (WHERE t.a_un_compte)::int AS joignables
           FROM (
             SELECT RIGHT(regexp_replace(c.client_telephone, '\\D', '', 'g'), 9) AS numero,
                    EXISTS (
                      SELECT 1 FROM utilisateur u
                       WHERE u.deleted_at IS NULL
                         AND u.telephone IS NOT NULL
                         AND RIGHT(regexp_replace(u.telephone, '\\D', '', 'g'), 9)
                           = RIGHT(regexp_replace(c.client_telephone, '\\D', '', 'g'), 9)
                    ) AS a_un_compte
               FROM commande c
              WHERE c.vendeur_id = :vendeurId
                AND c.origine = 'vitrine'
                AND c.client_telephone IS NOT NULL
                AND length(regexp_replace(c.client_telephone, '\\D', '', 'g')) >= 9
           ) t`,
        { replacements: { vendeurId }, type: sequelize.QueryTypes.SELECT }
      ),
    ]);

    const parOrigine = (cle) => {
      const ligne = canaux.find((c) => c.origine === cle);
      return {
        commandes: ligne ? Number(ligne.commandes) : 0,
        chiffreAffaires: ligne ? Number(ligne.chiffre_affaires) : 0,
      };
    };

    const clients = Number(conversion[0]?.clients) || 0;
    const joignables = Number(conversion[0]?.joignables) || 0;

    return {
      canaux: {
        application: parOrigine('application'),
        site: parOrigine('vitrine'),
        dashboard: parOrigine('dashboard'),
      },
      conversion: {
        // Clients distincts ayant commandé depuis le site de la boutique.
        clientsDuSite: clients,
        // Ceux dont le numéro correspond à un compte SaamBiz : le vendeur peut
        // leur écrire et leur envoyer ses nouveautés.
        joignables,
        aConvertir: Math.max(0, clients - joignables),
        // Arrondi à l'entier : un taux à la décimale près sur douze clients
        // donnerait une fausse impression de précision.
        taux: clients ? Math.round((joignables / clients) * 100) : 0,
      },
    };
  }

  /**
   * Statistiques de ventes d'un vendeur, calculées à partir des commandes reçues.
   * CA = somme des montants des commandes payées ou livrées.
   */
  static async _statsVentes(vendeurId) {
    const PAYEES = { [Op.or]: [{ statutPaiement: 'paye' }, { statut: 'livree' }] };

    const [chiffreAffairesRaw, nombreCommandes, commandesEnAttente, lignes7j] = await Promise.all([
      Commande.sum('montantTotal', { where: { vendeurId, ...PAYEES } }),
      Commande.count({ where: { vendeurId } }),
      Commande.count({ where: { vendeurId, statut: 'en_attente' } }),
      // Revenus par jour sur 7 jours glissants
      Commande.findAll({
        where: {
          vendeurId,
          ...PAYEES,
          createdAt: { [Op.gte]: sequelize.literal("NOW() - INTERVAL '7 days'") },
        },
        attributes: [
          [fn('DATE', col('created_at')), 'jour'],
          [fn('SUM', col('montant_total')), 'montant'],
        ],
        group: [fn('DATE', col('created_at'))],
        order: [[fn('DATE', col('created_at')), 'ASC']],
        raw: true,
      }),
    ]);

    // Complète les jours manquants à 0 pour un graphe régulier
    const parJour = new Map(lignes7j.map(r => [String(r.jour).slice(0, 10), Number(r.montant) || 0]));
    const revenus7Jours = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      revenus7Jours.push({ date: key, montant: parJour.get(key) || 0 });
    }

    return {
      chiffreAffaires: Number(chiffreAffairesRaw) || 0,
      nombreCommandes,
      commandesEnAttente,
      revenus7Jours,
    };
  }

  // -------------------- STATISTIQUES AVANCÉES --------------------
  static async statistiquesAvancees(vendeurId) {
    const boutique = await Boutique.findOne({ where: { vendeurId } });

    const [produits, messagesCount, paiements] = await Promise.all([
      Produit.findAll({
        where: { vendeurId },
        attributes: ['id', 'nom', 'vues', 'prix', 'image', 'disponible']
      }),
      Message.count({ where: { destinataireId: vendeurId } }),
      Paiement.findAll({
        where: { utilisateurId: vendeurId, statut: 'success' },
        attributes: ['montant']
      })
    ]);

    const totalVues = produits.reduce((acc, p) => acc + (p.vues || 0), 0);
    const produitPlusVu = produits.sort((a, b) => (b.vues || 0) - (a.vues || 0))[0] || null;

    let nombreFavoris = 0;
    if (boutique) {
      nombreFavoris = await Favori.count({ where: { boutiqueId: boutique.id } });
    }

    const totalPaiements = paiements.reduce((s, p) => s + (p.montant || 0), 0);

    return {
      totalVues, nombreProduits: produits.length, produitPlusVu,
      nombreFavoris, messagesRecus: messagesCount, totalPaiements,
      produits: produits.sort((a, b) => (b.vues || 0) - (a.vues || 0))
    };
  }

  // -------------------- TOGGLE DISPONIBILITÉ --------------------
  static async toggleDisponibilite(vendeurId, produitId) {
    const produit = await Produit.findOne({ where: { id: produitId, vendeurId } });
    if (!produit) throw new NotFoundError('Produit introuvable ou accès interdit');

    await produit.update({ disponible: !produit.disponible });
    return {
      message: produit.disponible ? 'Produit marqué comme disponible' : 'Produit marqué comme indisponible',
      disponible: produit.disponible
    };
  }

  // -------------------- MODE PAUSE BOUTIQUE --------------------
  static async pauseBoutique(vendeurId) {
    const boutique = await Boutique.findOne({ where: { vendeurId } });
    if (!boutique) throw new NotFoundError('Boutique introuvable');
    await Produit.update({ disponible: false }, { where: { vendeurId } });
    return { message: 'Boutique mise en pause — tous les produits sont maintenant indisponibles' };
  }

  static async reactiverBoutique(vendeurId) {
    const boutique = await Boutique.findOne({ where: { vendeurId } });
    if (!boutique) throw new NotFoundError('Boutique introuvable');
    await Produit.update({ disponible: true }, { where: { vendeurId } });
    return { message: 'Boutique réactivée — tous les produits sont maintenant disponibles' };
  }

  // -------------------- DUPLIQUER PRODUIT --------------------
  static async dupliquerProduit(vendeurId, produitId) {
    const original = await Produit.findOne({ where: { id: produitId, vendeurId } });
    if (!original) throw new NotFoundError('Produit introuvable ou accès interdit');

    const copie = await Produit.create({
      nom: `${original.nom} (copie)`,
      description: original.description,
      prix: original.prix,
      prix_promo: original.prix_promo,
      quantite: original.quantite,
      image: original.image,
      categorieId: original.categorieId,
      vendeurId,
      marque: original.marque,
      attributs: original.attributs,
      disponible: false,
      statut: 'approuve'
    });

    return { message: 'Produit dupliqué avec succès', produit: copie };
  }

  // -------------------- RECHERCHE PRODUITS --------------------
  // HIGH-02 : pagination ajoutée
  static async rechercherMesProduits(vendeurId, { q, categorieId, disponible, page = 1, limit = DEFAULT_PAGE_SIZE }) {
    const where = { vendeurId };
    if (q) where.nom = { [Op.iLike]: `%${q}%` };
    if (categorieId) where.categorieId = categorieId;
    if (disponible !== undefined) where.disponible = disponible === 'true';

    const { limit: l, offset } = paginate(page, limit);
    const { rows, count } = await Produit.findAndCountAll({
      where,
      include: [
        { model: Categorie, as: 'categorie', attributes: ['id', 'nom'] },
        { model: ProduitImage, as: 'images', attributes: ['id', 'url', 'ordre'] },
      ],
      order: [['createdAt', 'DESC']],
      limit: l,
      offset
    });
    return { total: count, page: parseInt(page), pages: Math.ceil(count / l), produits: rows };
  }

  // -------------------- HISTORIQUE PAIEMENTS --------------------
  // HIGH-02 : pagination ajoutée
  static async historiquePaiements(vendeurId, { page = 1, limit = DEFAULT_PAGE_SIZE } = {}) {
    const { limit: l, offset } = paginate(page, limit);
    const { rows, count } = await Paiement.findAndCountAll({
      where: { utilisateurId: vendeurId },
      attributes: ['id', 'montant', 'statut', 'methode', 'datePaiement', 'createdAt'],
      order: [['createdAt', 'DESC']],
      limit: l,
      offset
    });
    const totalPaye = rows
      .filter(p => p.statut === 'success')
      .reduce((s, p) => s + (p.montant || 0), 0);
    return { total: count, page: parseInt(page), pages: Math.ceil(count / l), totalPaye, paiements: rows };
  }

  // -------------------- MES CONVERSATIONS --------------------
  // HIGH-02 : pagination ajoutée
  static async mesConversations(vendeurId, { page = 1, limit = DEFAULT_PAGE_SIZE } = {}) {
    const { limit: l, offset } = paginate(page, limit);
    const messages = await Message.findAll({
      where: { [Op.or]: [{ expediteurId: vendeurId }, { destinataireId: vendeurId }] },
      include: [
        { model: Utilisateur, as: 'expediteur', attributes: ['id', 'prenom', 'nom', 'photoProfil', 'role'] },
        { model: Utilisateur, as: 'destinataire', attributes: ['id', 'prenom', 'nom', 'photoProfil', 'role'] }
      ],
      order: [['createdAt', 'DESC']],
      limit: l,
      offset
    });

    const conversationsMap = new Map();
    for (const msg of messages) {
      const interlocuteurId = msg.expediteurId === vendeurId ? msg.destinataireId : msg.expediteurId;
      if (!conversationsMap.has(interlocuteurId)) {
        const interlocuteur = msg.expediteurId === vendeurId ? msg.destinataire : msg.expediteur;
        conversationsMap.set(interlocuteurId, {
          interlocuteur,
          dernierMessage: { contenu: msg.contenu, date: msg.createdAt, lu: msg.lu },
          nonLus: 0
        });
      }
    }

    const nonLusParConv = await Message.findAll({
      where: { destinataireId: vendeurId, lu: false },
      attributes: ['expediteurId', [fn('COUNT', col('id')), 'nonLus']],
      group: ['expediteurId'],
      raw: true
    });

    for (const r of nonLusParConv) {
      if (conversationsMap.has(r.expediteurId)) {
        conversationsMap.get(r.expediteurId).nonLus = parseInt(r.nonLus);
      }
    }

    const conversations = Array.from(conversationsMap.values());
    return { total: conversations.length, conversations };
  }

  // -------------------- IMAGES MULTIPLES PRODUIT --------------------

  // Ajoute une ou plusieurs images à un produit du vendeur connecté
  static async ajouterImagesProduit(vendeurId, produitId, files) {
    const produit = await Produit.findOne({ where: { id: produitId, vendeurId } });
    if (!produit) throw new NotFoundError('Produit introuvable ou accès interdit');

    const dernierOrdre = await ProduitImage.count({ where: { produitId } });

    const images = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.buffer) continue;
      const url = await uploadImage(file.buffer);
      const image = await ProduitImage.create({
        produitId,
        url,
        ordre: dernierOrdre + i,
      });
      images.push(image);
    }
    return images;
  }

  // Supprime une image d'un produit du vendeur connecté (et côté Cloudinary si possible)
  static async supprimerImageProduit(vendeurId, produitId, imageId) {
    const produit = await Produit.findOne({ where: { id: produitId, vendeurId } });
    if (!produit) throw new NotFoundError('Produit introuvable ou accès interdit');

    const image = await ProduitImage.findOne({ where: { id: imageId, produitId } });
    if (!image) throw new NotFoundError('Image introuvable');

    await deleteImage(image.url);
    await image.destroy();

    return { message: 'Image supprimée avec succès' };
  }
}

module.exports = VendeurService;
