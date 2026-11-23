const { Produit, Categorie, Boutique, Abonnement, Message, Paiement, Favori, Utilisateur, ProduitImage, Commande, LigneCommande } = require('../../models');
const { niveauFidelite } = require('../../utils/fideliteClient');
const { uploadImage, uploadDocumentPrive, deleteImage } = require('../stockage/upload.service');
const sequelize = require('../../config/db');
const NotificationService = require('../notifications/notification.service');
const { appliquerDefautsBoutique, genererSlugUnique } = require('../../utils/boutiqueDefaults');
const CategorieBoutiqueService = require('../categories/categorieBoutique.service');
const { validerAttributs } = require('../categories/specifications');
const { Op, fn, col } = require('sequelize');
const crypto = require('crypto');
const { BadRequestError, ConflictError, NotFoundError, ServiceUnavailableError } = require('../../errors/AppError');
const { normaliserTelephone, erreurTelephone } = require('../../utils/telephone');

// Dix par page, depuis l'unique source. La copie locale de `paginate` qui
// se trouvait plus bas prenait le `limit` de la requete sans borne haute.
const { paginate, LIMITE_DEFAUT } = require('../../utils/paginate');

const DEFAULT_PAGE_SIZE = LIMITE_DEFAUT;

// Photos du haut du site : assez pour un défilé, pas au point d'alourdir la
// page d'un client sur forfait mobile.
const PHOTOS_VITRINE_MAX = 10;

// Mises en page proposées pour la vitrine — la liste du service fait foi.
const { MODELES_VITRINE, ICONES_VITRINE } = require('../vitrine/vitrine.service');
const VisiteService = require('../visites/visite.service');
const echecIgnore = require('../../utils/echecIgnore');

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

// Champs modifiables sur un Produit (liste blanche)
const PRODUIT_FIELDS = ['nom', 'description', 'prix', 'prix_promo', 'quantite', 'categorieId', 'marque', 'attributs', 'disponible'];

// Champs modifiables sur une Boutique (liste blanche)
const BOUTIQUE_FIELDS = ['nom', 'slug', 'description', 'slogan', 'localisation', 'telephone', 'whatsapp', 'ville', 'latitude', 'longitude', 'banniere', 'couleur_theme', 'categorie'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ATTRIBUTS_ABONNE = ['id', 'prenom', 'nom', 'photoProfil', 'email', 'telephone'];

function formaterAbonne(favori) {
  const a = favori.acheteur;
  return {
    id: a.id,
    prenom: a.prenom,
    nom: a.nom,
    photo: a.photoProfil || null,
    email: a.email,
    telephone: a.telephone || null,
    clocheActive: favori.clocheActive === true,
    depuis: favori.createdAt,
  };
}

class VendeurService {

  // -------------------- LISTER PRODUITS --------------------
  // Liste paginée
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
      if (image?.buffer) imageUrl = await uploadImage(image.buffer, 'produits');

      // Caractéristiques vérifiées selon les spécifications de la catégorie
      // (tailles, pointures, contenance…). Un ancien client qui n'envoie pas
      // `attributs` du tout n'est pas bloqué ; dès qu'il les envoie, les
      // champs obligatoires de la catégorie s'appliquent.
      const attributsParsed = await VendeurService._verifierAttributs(categorieId, attributs, t);

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
      ).catch(echecIgnore('notification nouveau produit aux abonnés'));

      return produit;
    } catch (err) {
      await t.rollback();
      throw err;
    }
  }

  /**
   * Catégorie active obligatoire ; caractéristiques vérifiées selon ses
   * spécifications quand elles sont transmises.
   * @returns {object|null|undefined} attributs normalisés
   */
  static async _verifierAttributs(categorieId, attributs, transaction) {
    if (!categorieId) throw new BadRequestError('Choisissez une catégorie');
    const categorie = await Categorie.findOne({
      where: { id: categorieId, active: true },
      attributes: ['id', 'specifications'],
      transaction,
    });
    if (!categorie) throw new BadRequestError('Catégorie inconnue ou masquée');
    if (attributs === undefined) return undefined;
    if (attributs === null || attributs === '') return null;
    const valeurs = validerAttributs(categorie.specifications || [], attributs);
    return Object.keys(valeurs).length ? valeurs : null;
  }

  // -------------------- MODIFIER PRODUIT --------------------
  // Whitelist stricte des champs modifiables
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

      if (updates.attributs !== undefined) {
        safeUpdates.attributs = await VendeurService._verifierAttributs(
          safeUpdates.categorieId || produit.categorieId, updates.attributs, t,
        );
      } else if (safeUpdates.categorieId) {
        await VendeurService._verifierAttributs(safeUpdates.categorieId, undefined, t);
      }

      // Upload image si fournie (vient du middleware multer, pas du body)
      if (updates.image?.buffer) {
        safeUpdates.image = await uploadImage(updates.image.buffer, 'produits');
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

  /** La boutique du vendeur, sans ses produits — `null` s'il n'en a pas encore. */
  static async trouverBoutique(vendeurId) {
    return Boutique.findOne({ where: { vendeurId } });
  }

  // -------------------- MA BOUTIQUE --------------------
  static async maBoutique(vendeurId) {
    const boutique = await Boutique.findOne({ where: { vendeurId } });
    if (!boutique) throw new NotFoundError('Boutique introuvable');
    // Les produits sont rattachés au vendeur, pas à la boutique : il n'existe
    // pas d'association Boutique → Produit, et l'inclure faisait échouer la
    // page « Ma boutique » (« Produit is not associated to Boutique »).
    const produits = await Produit.findAll({
      where: { vendeurId },
      attributes: ['id', 'nom', 'prix', 'prix_promo', 'image', 'disponible', 'vues', 'statut'],
    });
    const totalVues = produits.reduce((acc, p) => acc + (p.vues || 0), 0);
    const categories = await CategorieBoutiqueService.lister(boutique.id);
    return {
      boutique: { ...boutique.toJSON(), produits: produits.map((p) => p.toJSON()), categories },
      stats: { totalVues, nombreProduits: produits.length },
    };
  }

  // -------------------- CRÉER BOUTIQUE --------------------
  static async creerBoutique(vendeurId, data, files = {}) {
    const existante = await Boutique.findOne({ where: { vendeurId } });
    if (existante) throw new ConflictError('Vous avez déjà une boutique');

    // Whitelist champs boutique
    let safeData = {};
    for (const field of BOUTIQUE_FIELDS) {
      if (data[field] !== undefined) safeData[field] = data[field];
    }
    VendeurService._verifierNumerosBoutique(safeData);

    // Uploads logo & bannière
    if (files.logo?.buffer) safeData.logo = await uploadImage(files.logo.buffer, 'boutiques');
    if (files.banniere?.buffer) safeData.banniere = await uploadImage(files.banniere.buffer, 'boutiques');

    // Modèle de boutique par défaut (cohérence quel que soit le type de vendeur)
    safeData = appliquerDefautsBoutique(safeData);
    if (!safeData.slug) safeData.slug = await genererSlugUnique(safeData.nom);

    // Boutique et catégories ensemble : une boutique sans catégorie
    // n'apparaîtrait dans aucun filtre de l'accueil.
    const boutique = await sequelize.transaction(async (transaction) => {
      const creee = await Boutique.create({ ...safeData, vendeurId }, { transaction });
      await CategorieBoutiqueService.definir(creee, data, { transaction });
      return creee;
    });
    const categories = await CategorieBoutiqueService.lister(boutique.id);
    return { boutique: { ...boutique.toJSON(), categories } };
  }

  // -------------------- MODIFIER BOUTIQUE --------------------
  // Whitelist stricte des champs modifiables
  /**
   * Téléphone et WhatsApp de la boutique : vérifiés selon leur pays et
   * enregistrés au format international (« +221771234567 »). Vide = effacé.
   */
  static _verifierNumerosBoutique(safeData) {
    for (const champ of ['telephone', 'whatsapp']) {
      if (safeData[champ] === undefined) continue;
      if (!String(safeData[champ] ?? '').trim()) {
        safeData[champ] = null;
        continue;
      }
      const erreur = erreurTelephone(safeData[champ]);
      if (erreur) throw new BadRequestError(champ === 'whatsapp' ? `WhatsApp : ${erreur}` : erreur);
      safeData[champ] = normaliserTelephone(safeData[champ]);
    }
  }

  static async modifierBoutique(vendeurId, data, files = {}) {
    const boutique = await Boutique.findOne({ where: { vendeurId } });
    if (!boutique) throw new NotFoundError('Boutique introuvable');

    const safeData = {};
    for (const field of BOUTIQUE_FIELDS) {
      if (data[field] !== undefined) safeData[field] = data[field];
    }
    VendeurService._verifierNumerosBoutique(safeData);

    if (files.logo?.buffer) safeData.logo = await uploadImage(files.logo.buffer, 'boutiques');
    if (files.banniere?.buffer) safeData.banniere = await uploadImage(files.banniere.buffer, 'boutiques');

    await sequelize.transaction(async (transaction) => {
      await boutique.update(safeData, { transaction });
      // `categories` (1 à 3) ou l'ancien `categorie` seul ; absent = inchangé.
      await CategorieBoutiqueService.definir(boutique, data, { transaction });
    });
    const categories = await CategorieBoutiqueService.lister(boutique.id);
    return { boutique: { ...boutique.toJSON(), categories } };
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

    const [nombreProduits, visitesRecentes] = await Promise.all([
      Produit.count({ where: { vendeurId, statut: 'approuve' } }),
      VisiteService.recentes(boutique.id),
    ]);

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
          nouveautes: boutique.vitrineSections?.nouveautes !== false,
          meilleures: boutique.vitrineSections?.meilleures !== false,
        },
        blocs: VendeurService._blocsVides(boutique.vitrineBlocs),
        commande: boutique.vitrineCommande !== false,
        paiementLivraison: boutique.vitrinePaiementLivraison !== false,
        // Visites uniques par jour, application et site : même nombre que
        // « Visites » sur le tableau de bord.
        vues: boutique.vitrineVues || 0,
        visitesRecentes,
        sectionsPerso: Array.isArray(boutique.vitrineSectionsPerso) ? boutique.vitrineSectionsPerso : [],
        // Photos du haut du site, dans l'ordre où elles défilent.
        photos: VendeurService._photosVitrine(boutique.vitrinePhotos),
        photosMax: PHOTOS_VITRINE_MAX,

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
    // Seules les clés connues sont retenues, et seulement en http(s) :
    // ces valeurs finissent dans un href sur une page publique, un
    // `javascript:` recopié tel quel y deviendrait exécutable.
    if (data.reseaux !== undefined) {
      const source = data.reseaux || {};
      const reseaux = {};
      for (const cle of ['facebook', 'instagram', 'snapchat', 'tiktok', 'site']) {
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
        nouveautes: s.nouveautes !== false,
        meilleures: s.meilleures !== false,
      };
    }

    // ── Bannières, bloc contact, icônes, avantages ───────────────────
    if (data.blocs !== undefined) {
      maj.vitrineBlocs = await VendeurService._validerBlocs(vendeurId, data.blocs);
    }

    // ── Sections personnalisées ──────────────────────────────────────
    // Au plus 12 sections de 60 produits ; seuls les produits du vendeur
    // sont retenus (un identifiant étranger est ignoré sans erreur).
    if (data.sectionsPerso !== undefined) {
      const source = Array.isArray(data.sectionsPerso) ? data.sectionsPerso.slice(0, 12) : [];
      const demandes = [...new Set(source.flatMap((s) => (Array.isArray(s?.produitIds) ? s.produitIds : [])).map(String))];
      const UUID = /^[0-9a-f-]{36}$/i;
      const autorises = new Set(demandes.filter((id) => UUID.test(id)).length
        ? (await Produit.findAll({
          where: { vendeurId, id: demandes.filter((id) => UUID.test(id)) },
          attributes: ['id'],
        })).map((p) => p.id)
        : []);
      const sections = source.map((s, i) => {
        const titre = String(s?.titre || '').replace(/\s+/g, ' ').trim().slice(0, 60);
        if (!titre) throw new BadRequestError(`Donnez un nom à la section n° ${i + 1}.`);
        const id = /^[A-Za-z0-9_-]{4,40}$/.test(String(s?.id || '')) ? String(s.id) : `s${Date.now().toString(36)}${i}`;
        const produitIds = [...new Set((s.produitIds || []).map(String))].filter((pid) => autorises.has(pid)).slice(0, 60);
        return { id, titre, produitIds };
      });
      maj.vitrineSectionsPerso = sections.length ? sections : null;
    }

    // ── Publication et caisse ────────────────────────────────────────
    if (data.active !== undefined) maj.vitrineActive = !!data.active;
    // Ouverture depuis le tableau de bord web, sans passer par l'assistant
    // de l'application : le site part avec la mise en page par défaut, aux
    // informations de la boutique ; le vendeur l'ajuste ensuite.
    if (maj.vitrineActive && !boutique.vitrineConfiguree) {
      maj.vitrineConfiguree = true;
      if (!boutique.vitrineCreeeLe) maj.vitrineCreeeLe = new Date();
      if (!boutique.slug && !maj.slug) maj.slug = await genererSlugUnique(boutique.nom);
    }
    if (data.commande !== undefined) maj.vitrineCommande = !!data.commande;
    if (data.paiementLivraison !== undefined) maj.vitrinePaiementLivraison = !!data.paiementLivraison;

    await boutique.update(maj);
    return await VendeurService.maVitrine(vendeurId);
  }

  static _blocsVides(blocs) {
    const b = blocs && typeof blocs === 'object' ? blocs : {};
    return {
      icones: b.icones && typeof b.icones === 'object' ? b.icones : {},
      avantages: Array.isArray(b.avantages) ? b.avantages : [],
    };
  }

  /**
   * Contenus composés par le vendeur : les avantages (« Livraison rapide »…)
   * et les icônes des catégories. Aucun avantage, pas de bandeau.
   */
  static async _validerBlocs(vendeurId, source) {
    const b = source && typeof source === 'object' ? source : {};
    const texte = (v, max) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);

    const icones = {};
    const sourceIcones = b.icones && typeof b.icones === 'object' ? b.icones : {};
    for (const [cat, cle] of Object.entries(sourceIcones).slice(0, 60)) {
      if (!/^[0-9a-zA-Z_-]{1,40}$/.test(cat)) continue;
      if (!ICONES_VITRINE.includes(cle)) throw new BadRequestError('Icône inconnue.');
      icones[cat] = cle;
    }

    const avantages = (Array.isArray(b.avantages) ? b.avantages : []).slice(0, 4).map((x, i) => {
      if (!ICONES_VITRINE.includes(x?.icone)) throw new BadRequestError('Icône inconnue.');
      const titre = texte(x?.titre, 40);
      if (!titre) throw new BadRequestError(`Donnez un titre à l'avantage n° ${i + 1}.`);
      return { icone: x.icone, titre, texte: texte(x?.texte, 60) };
    });

    return !Object.keys(icones).length && !avantages.length ? null : { icones, avantages };
  }

  /**
   * Les clients abonnés à la boutique du vendeur, du plus récent au plus
   * ancien, avec l'état de leur cloche (seuls ceux qui l'ont activée
   * reçoivent les notifications de la boutique).
   */
  static async abonnes(vendeurId) {
    const boutique = await Boutique.findOne({ where: { vendeurId }, attributes: ['id'] });
    if (!boutique) throw new NotFoundError('Boutique introuvable');
    const favoris = await Favori.findAll({
      where: { boutiqueId: boutique.id },
      include: [{ model: Utilisateur, as: 'acheteur', attributes: ATTRIBUTS_ABONNE }],
      order: [['createdAt', 'DESC']],
    });
    const liste = favoris.filter((f) => f.acheteur).map(formaterAbonne);
    return {
      total: liste.length,
      avecCloche: liste.filter((a) => a.clocheActive).length,
      abonnes: liste,
    };
  }

  // Fiche d'un abonné. Le lien d'abonnement à CETTE boutique est vérifié : sans
  // lui, un vendeur lirait les coordonnées de n'importe quel compte.
  static async abonneDetail(vendeurId, acheteurId) {
    // Un identifiant mal formé ferait échouer la requête SQL en erreur 500.
    if (!UUID.test(acheteurId)) throw new NotFoundError('Abonné introuvable');
    const boutique = await Boutique.findOne({ where: { vendeurId }, attributes: ['id'] });
    if (!boutique) throw new NotFoundError('Boutique introuvable');
    const favori = await Favori.findOne({
      where: { boutiqueId: boutique.id, acheteurId },
      include: [{ model: Utilisateur, as: 'acheteur', attributes: ATTRIBUTS_ABONNE }],
    });
    if (!favori || !favori.acheteur) throw new NotFoundError('Abonné introuvable');

    const commandes = await Commande.findAll({
      where: { vendeurId, acheteurId, statut: { [Op.notIn]: ['annulee', 'rejetee'] } },
      attributes: ['id', 'createdAt'],
      include: [{ model: LigneCommande, as: 'lignes', attributes: ['quantite'] }],
      order: [['createdAt', 'DESC']],
    });
    return {
      abonne: formaterAbonne(favori),
      activite: {
        commandes: commandes.length,
        produitsCommandes: commandes.reduce(
          (total, c) => total + c.lignes.reduce((n, l) => n + l.quantite, 0),
          0
        ),
        derniereCommande: commandes[0]?.createdAt ?? null,
      },
      fidelite: niveauFidelite(commandes.length),
    };
  }

  // -------------------- SUPPRIMER MON SITE --------------------
  // Seule la présence en ligne disparaît : les produits restent dans
  // l'application et dans le tableau de bord.
  // ── Photos du haut du site ────────────────────────────────────────
  //
  //  Elles défilent en boucle dans le grand bandeau de l'accueil. Le
  //  vendeur les ajoute (plusieurs d'un coup), les retire et les range ;
  //  il ne saisit jamais d'adresse d'image : seules les photos téléversées
  //  ici entrent dans la liste, une page publique n'affiche donc rien qui
  //  vienne d'ailleurs.

  /** La liste enregistrée, nettoyée : [{ id, url }], au plus PHOTOS_VITRINE_MAX. */
  static _photosVitrine(brutes) {
    if (!Array.isArray(brutes)) return [];
    return brutes
      .filter((p) => p && typeof p.id === 'string' && /^https:\/\//i.test(String(p.url || '')))
      .slice(0, PHOTOS_VITRINE_MAX)
      .map((p) => ({ id: p.id, url: p.url }));
  }

  /**
   * Relit la liste sous verrou, la modifie, l'enregistre. Deux ajouts
   * envoyés en même temps (deux onglets, un double appui) s'additionnent
   * au lieu que le second efface le premier.
   */
  static async _modifierPhotosVitrine(vendeurId, modifier) {
    return sequelize.transaction(async (transaction) => {
      const boutique = await Boutique.findOne({
        where: { vendeurId },
        lock: transaction.LOCK.UPDATE,
        transaction,
      });
      if (!boutique) throw new NotFoundError("Créez d'abord votre boutique pour ouvrir votre site.");
      const avant = VendeurService._photosVitrine(boutique.vitrinePhotos);
      const resultat = modifier(avant);
      await boutique.update({ vitrinePhotos: resultat.photos.length ? resultat.photos : null }, { transaction });
      return resultat;
    });
  }

  /**
   * Ajoute des photos à la fin du défilé. Les envois partent en parallèle ;
   * une photo refusée par l'hébergeur n'empêche pas les autres d'entrer.
   * Au-delà de PHOTOS_VITRINE_MAX, les dernières sont écartées et le
   * message le dit.
   */
  static async ajouterPhotosVitrine(vendeurId, files = []) {
    const fichiers = (files || []).filter((f) => f?.buffer);
    if (!fichiers.length) throw new BadRequestError('Choisissez au moins une photo.');

    const boutique = await Boutique.findOne({ where: { vendeurId }, attributes: ['id', 'vitrinePhotos'] });
    if (!boutique) throw new NotFoundError("Créez d'abord votre boutique pour ouvrir votre site.");
    const place = PHOTOS_VITRINE_MAX - VendeurService._photosVitrine(boutique.vitrinePhotos).length;
    if (place <= 0) {
      throw new BadRequestError(
        `Votre site a déjà ${PHOTOS_VITRINE_MAX} photos : retirez-en une pour en ajouter une autre.`
      );
    }

    const envois = await Promise.allSettled(fichiers.slice(0, place).map((f) => uploadImage(f.buffer, 'vitrine')));
    const urls = envois.filter((e) => e.status === 'fulfilled').map((e) => e.value);
    if (!urls.length) {
      throw new ServiceUnavailableError("Les photos n'ont pas pu être envoyées. Réessayez dans un instant.");
    }

    const nouvelles = urls.map((url) => ({ id: crypto.randomBytes(6).toString('hex'), url }));
    const { retenues } = await VendeurService._modifierPhotosVitrine(vendeurId, (avant) => {
      // Relue sous verrou : un autre ajout a pu passer entre-temps.
      const restantes = Math.max(0, PHOTOS_VITRINE_MAX - avant.length);
      const gardees = nouvelles.slice(0, restantes);
      return { photos: [...avant, ...gardees], retenues: gardees };
    });

    // Envoyées mais sans place (ajout concurrent) : on ne laisse rien traîner
    // chez l'hébergeur.
    const idsRetenus = new Set(retenues.map((p) => p.id));
    await Promise.allSettled(nouvelles.filter((p) => !idsRetenus.has(p.id)).map((p) => deleteImage(p.url)));
    if (!retenues.length) {
      throw new BadRequestError(
        `Votre site a déjà ${PHOTOS_VITRINE_MAX} photos : retirez-en une pour en ajouter une autre.`
      );
    }

    // Le message dit ce qui est entré, et pourquoi le reste ne l'est pas.
    const horsPlace = (fichiers.length - envois.length) + (urls.length - retenues.length);
    const echouees = envois.length - urls.length;
    const accord = (n, verbe) => `${n} n'${n > 1 ? 'ont' : 'a'} pas ${verbe}${n > 1 ? 's' : ''}`;
    let message = retenues.length > 1 ? `${retenues.length} photos ajoutées à votre site.` : 'Photo ajoutée à votre site.';
    if (horsPlace > 0) message += ` ${accord(horsPlace, 'été ajoutée')} : ${PHOTOS_VITRINE_MAX} photos au plus.`;
    if (echouees > 0) message += ` ${accord(echouees, 'pu être envoyée')}, réessayez.`;
    return { ...(await VendeurService.maVitrine(vendeurId)), message };
  }

  /** Retire une photo du défilé, puis de l'hébergeur. */
  static async supprimerPhotoVitrine(vendeurId, photoId) {
    const { retiree } = await VendeurService._modifierPhotosVitrine(vendeurId, (avant) => {
      const photo = avant.find((p) => p.id === String(photoId));
      if (!photo) throw new NotFoundError('Cette photo a déjà été retirée.');
      return { photos: avant.filter((p) => p !== photo), retiree: photo };
    });
    await deleteImage(retiree.url);
    return VendeurService.maVitrine(vendeurId);
  }

  /**
   * Range les photos dans l'ordre reçu (liste d'identifiants). Une photo
   * absente de la liste garde sa place relative, à la fin : un écran en
   * retard d'un ajout ne la fait pas disparaître.
   */
  static async ordonnerPhotosVitrine(vendeurId, ids) {
    if (!Array.isArray(ids)) throw new BadRequestError("L'ordre des photos est invalide.");
    await VendeurService._modifierPhotosVitrine(vendeurId, (avant) => {
      const parId = new Map(avant.map((p) => [p.id, p]));
      const enTete = [...new Set(ids.map(String))].filter((id) => parId.has(id)).map((id) => parId.get(id));
      const reste = avant.filter((p) => !enTete.includes(p));
      return { photos: [...enTete, ...reste] };
    });
    return VendeurService.maVitrine(vendeurId);
  }

  static async supprimerVitrine(vendeurId) {
    const boutique = await Boutique.findOne({ where: { vendeurId } });
    if (!boutique) throw new NotFoundError('Boutique introuvable');
    const photos = VendeurService._photosVitrine(boutique.vitrinePhotos);
    await boutique.update(Boutique.reglagesSiteParDefaut());
    // Le site parti, ses photos n'ont plus de raison d'être hébergées.
    await Promise.allSettled(photos.map((p) => deleteImage(p.url)));
    return VendeurService.maVitrine(vendeurId);
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
    // `statut === 'actif'` et non la seule date de fin : un abonnement révoqué
    // par un administrateur garde sa `dateFin`, parfois lointaine. Sans cette
    // condition, le vendeur se voyait répondre « votre abonnement est encore
    // actif » alors qu'il venait d'être retiré — il ne pouvait donc ni vendre
    // ni se réabonner jusqu'à l'échéance initiale.
    if (abonnement && abonnement.statut === 'actif') {
      const fin = new Date(abonnement.dateFin);
      const joursRestants = Math.ceil((fin - now) / (1000 * 60 * 60 * 24));
      if (joursRestants > 7) throw new BadRequestError('Votre abonnement est encore actif (plus de 7 jours restants)');
    }

    return { montant: 2000, devise: 'FCFA', vendeurId, description: 'Renouvellement abonnement Jëndal' };
  }

  // -------------------- STATISTIQUES VUES --------------------
  // Liste paginée
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
  static async soumettreVerification(vendeurId, { fichier, verso, typePiece }) {
    const vendeur = await Utilisateur.findOne({ where: { id: vendeurId, role: 'Vendeur' } });
    if (!vendeur) return { success: false, message: 'Vendeur introuvable' };

    if (vendeur.statutValidation === 'approuve') {
      return { success: false, message: 'Votre boutique est déjà certifiée.' };
    }
    if (vendeur.statutValidation === 'en_attente') {
      return { success: false, message: "Votre demande est déjà en cours d'examen." };
    }
    if (!fichier || !verso) {
      return { success: false, message: "Envoyez la photo du recto et celle du verso de votre pièce d'identité." };
    }

    // Pièces d'identité : bucket PRIVÉ (R2_PRIVATE_BUCKET_NAME). La base garde
    // « prive:<clé> » ; le back-office les ouvre par un lien signé de dix
    // minutes.
    const [pieceUrl, versoUrl] = await Promise.all([
      uploadDocumentPrive(fichier.buffer, 'certifications'),
      uploadDocumentPrive(verso.buffer, 'certifications'),
    ]);

    await vendeur.update({
      pieceIdentite: pieceUrl,
      pieceIdentiteVerso: versoUrl,
      typePiece: typePiece || null,
      statutValidation: 'en_attente',
      dateSoumission: new Date(),
      motifRejet: null,
    });

    return { success: true, message: "Demande envoyée. Notre équipe l'examine sous 48 h." };
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
        attributes: ['id', 'nom', 'logo', 'localisation', 'whatsapp', 'vitrineVues']
      }),
      Abonnement.findOne({
        where: { utilisateurId: vendeurId },
        order: [['createdAt', 'DESC']]
      }),
      Message.count({ where: { destinataireId: vendeurId, lu: false } }),
      // `notification` ne declare pas `underscored` : sa colonne est restee en
      // camelCase. En SQL brut il faut la CITER, sinon PostgreSQL la met en
      // minuscules, ne la trouve pas, et tout le tableau de bord tombe en 400.
      // Voir « Quatre tables en camelCase » dans le README.
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
    let visitesRecentes = { aujourdHui: 0, septJours: 0, trenteJours: 0 };

    if (boutique) {
      const [produitStats, favoriCount, recentes] = await Promise.all([
        Produit.findAll({ where: { vendeurId }, attributes: ['vues'] }),
        // Jointure obligatoire sur l'acheteur, et non un simple compte des
        // lignes : un client qui supprime son compte laisse sa ligne
        // d'abonnement derrière lui. Comptées, ces lignes orphelines
        // donnaient au tableau de bord un nombre d'abonnés que la liste
        // (`abonnes()`, qui les écarte) ne retrouvait jamais — un vendeur
        // lisait « 1 client abonné » sur son accueil et « personne » sur sa
        // page Abonnés. `Utilisateur` étant en suppression douce, la
        // jointure suffit à les exclure.
        Favori.count({
          where: { boutiqueId: boutique.id },
          include: [{ model: Utilisateur, as: 'acheteur', attributes: [], required: true }],
        }),
        VisiteService.recentes(boutique.id),
      ]);
      visitesRecentes = recentes;

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
        // Visites de la boutique (application et site, une par personne et
        // par jour) : LE nombre que « Ma boutique » affiche aussi.
        visites: boutique ? boutique.vitrineVues || 0 : 0,
        visitesRecentes,
        // Ouvertures des fiches produit. `totalVues` reste pour le tableau
        // de bord web, qui le lit sous ce nom.
        vuesProduits: totalVues,
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
  // Liste paginée
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
  // Liste paginée
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
  // Liste paginée
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

    // Les téléversements partent en parallèle : ils ne dépendent pas les uns
    // des autres, et huit allers-retours mis bout à bout, sur une connexion
    // mobile, font la différence entre une attente et un délai dépassé.
    // Le plafond de huit fichiers est posé par `upload.array('images', 8)` :
    // le parallélisme reste donc borné.
    const aTeleverser = files.filter((f) => f.buffer);
    const urls = await Promise.all(
      aTeleverser.map((f) => uploadImage(f.buffer, 'produits')),
    );

    if (urls.length === 0) return [];

    // Une seule écriture au lieu d'une par image. `ordre` suit la position
    // d'origine, comme avant.
    return ProduitImage.bulkCreate(
      urls.map((url, i) => ({ produitId, url, ordre: dernierOrdre + i })),
      { returning: true },
    );
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
