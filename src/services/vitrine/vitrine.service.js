// services/vitrine/vitrine.service.js
//
// La vitrine : le site web public d'une boutique, servi sur
// saambiz.sn/b/<slug>. Tout ici est accessible SANS COMPTE — c'est le point
// de la fonctionnalité : le client d'un vendeur arrive par un lien WhatsApp
// ou un QR code, voit le catalogue et commande, sans rien installer. Ce
// n'est qu'ensuite qu'on lui propose l'application, pour suivre la boutique
// et recevoir ses notifications.
//
// Deux conséquences sur l'écriture de ce service :
//
//   1. Aucune donnée qui ne soit pas destinée au public ne doit sortir d'ici.
//      Le vendeur publie un téléphone et un WhatsApp de boutique ; son email
//      de compte, son statut d'abonnement et ses pièces d'identité ne sont
//      jamais dans une réponse. D'où les listes ATTRIBUTS_* explicites : un
//      `include` sans `attributes` ferait sortir la ligne utilisateur entière.
//
//   2. Les entrées viennent d'inconnus. Les identifiants sont vérifiés,
//      la pagination est plafonnée, et le passage en caisse repasse par
//      CommandeService — qui tient déjà les verrous de stock et la règle
//      « une commande = une boutique ».

const { Op, fn, col } = require('sequelize');
const {
  Boutique, Produit, ProduitImage, Categorie, Utilisateur, Avis,
  Commande, LigneCommande,
} = require('../../models');
const CommandeService = require('../commandes/commande.service');
const { BadRequestError, ForbiddenError, NotFoundError } = require('../../errors/AppError');
const logger = require('../../utils/logger');

// Mises en page proposées au vendeur. Trois suffisent à couvrir ce que
// vendent les boutiques sénégalaises : du prêt-à-porter qui se montre en
// grand, de l'électronique qui se compare en liste, et le reste.
const MODELES_VITRINE = ['classique', 'galerie', 'catalogue'];

// Plafond de pagination : sans lui, `?limit=100000` fait sortir tout le
// catalogue en une requête, sur une route ouverte à tout le monde.
const LIMITE_MAX = 48;
const LIMITE_DEFAUT = 12;

// Ce qu'on publie d'un produit. Rien de plus : ni le vendeurId, ni les
// compteurs internes.
const ATTRIBUTS_PRODUIT = [
  'id', 'nom', 'description', 'prix', 'prix_promo', 'image', 'marque',
  'attributs', 'quantite', 'disponible', 'categorieId', 'createdAt',
];

// Ce qu'on publie du vendeur : de quoi afficher « Vendu par … », pas plus.
const ATTRIBUTS_VENDEUR = ['id', 'nom', 'prenom', 'statutValidation'];

class VitrineService {

  // ══════════════════════════════════════════════════════════════════
  //  HELPERS
  // ══════════════════════════════════════════════════════════════════

  /**
   * Prix réellement demandé au client.
   *
   * `prix_promo` est le prix soldé et `prix` le prix barré (voir le modèle
   * Produit). La vitrine affiche donc `prix_promo` quand il est renseigné et
   * inférieur — et c'est ce montant que CommandeService facture, sans quoi
   * le site annoncerait un prix et en prélèverait un autre.
   */
  static prixEffectif(produit) {
    const prix = parseFloat(produit.prix);
    const promo = produit.prix_promo != null ? parseFloat(produit.prix_promo) : null;
    return (promo != null && promo > 0 && promo < prix) ? promo : prix;
  }

  /** Forme publique d'un produit, prix déjà résolu pour l'affichage. */
  static _exposerProduit(produit) {
    const p = produit.get ? produit.get({ plain: true }) : produit;
    const prix = parseFloat(p.prix);
    const promo = p.prix_promo != null ? parseFloat(p.prix_promo) : null;
    const enPromo = promo != null && promo > 0 && promo < prix;

    return {
      id: p.id,
      nom: p.nom,
      description: p.description,
      // `prix` est ce que le client paie ; `prixBarre` n'est là que pour
      // l'affichage. Le front n'a ainsi aucun calcul de promo à refaire.
      prix: enPromo ? promo : prix,
      prixBarre: enPromo ? prix : null,
      remise: enPromo ? Math.round(((prix - promo) / prix) * 100) : 0,
      image: p.image,
      images: (p.images || []).map((i) => i.url),
      marque: p.marque,
      attributs: p.attributs || null,
      // On publie « en stock / bientôt épuisé / épuisé », pas le nombre
      // exact : le stock d'un concurrent n'a pas à être lisible en clair.
      disponible: !!p.disponible && p.quantite > 0,
      stockFaible: p.quantite > 0 && p.quantite <= 3,
      categorieId: p.categorieId,
      categorie: p.categorie ? { id: p.categorie.id, nom: p.categorie.nom } : null,
      nouveaute: p.createdAt ? (Date.now() - new Date(p.createdAt).getTime()) < 14 * 864e5 : false,
    };
  }

  /** Forme publique de la boutique + son thème. */
  static _exposerBoutique(boutique, extra = {}) {
    const b = boutique.get ? boutique.get({ plain: true }) : boutique;
    const modele = MODELES_VITRINE.includes(b.vitrineModele) ? b.vitrineModele : 'classique';

    return {
      id: b.id,
      slug: b.slug,
      nom: b.nom,
      slogan: b.slogan,
      description: b.description,
      logo: b.logo,
      // Comment poser le logo dans l'en-tête : 'rond' (pastille), 'carre'
      // (tuile arrondie), 'bandeau' (pleine largeur, le nom écrit est déjà
      // dedans) ou 'libre' (tel quel). Déduit du logo par l'assistant — un
      // logo rond rogné en carré perd ses bords.
      logoForme: b.vitrineLogoForme || 'libre',
      banniere: b.banniere,
      categorie: b.categorie,
      ville: b.ville,
      localisation: b.localisation,
      telephone: b.telephone,
      whatsapp: b.whatsapp,
      // Le badge « Boutique vérifiée » vient de la validation du VENDEUR par
      // un administrateur, pas d'un réglage que le vendeur pourrait cocher.
      verifiee: b.vendeur?.statutValidation === 'approuve',
      vendeur: b.vendeur ? { nom: b.vendeur.nom, prenom: b.vendeur.prenom } : null,

      theme: {
        modele,
        // vitrineAccent l'emporte, couleur_theme sert de repli : les
        // boutiques d'avant la vitrine ont déjà choisi une couleur.
        accent: b.vitrineAccent || b.couleur_theme || '#0D1B3D',
        sections: {
          apropos:    b.vitrineSections?.apropos    !== false,
          categories: b.vitrineSections?.categories !== false,
          avis:       b.vitrineSections?.avis       !== false,
          contact:    b.vitrineSections?.contact    !== false,
        },
      },

      apropos: b.vitrineApropos,
      annonce: b.vitrineAnnonce,
      horaires: b.vitrineHoraires,
      reseaux: b.vitrineReseaux || {},

      // Le client doit savoir avant de remplir son panier si la caisse est
      // ouverte, et s'il pourra payer à la livraison.
      commandeActivee: b.vitrineCommande !== false,
      paiementLivraison: b.vitrinePaiementLivraison !== false,

      ...extra,
    };
  }

  /**
   * Charge une boutique publiable depuis son slug.
   *
   * Une boutique suspendue par un administrateur, mise en pause par son
   * vendeur, ou dont la vitrine n'est pas publiée, répond 404 et non 403 :
   * l'existence d'une boutique fermée n'a pas à être confirmée à un visiteur.
   */
  static async _chargerBoutique(slug) {
    if (!slug || typeof slug !== 'string' || slug.length > 80) {
      throw new NotFoundError("Cette boutique n'existe pas.");
    }

    const boutique = await Boutique.findOne({
      where: { slug: slug.toLowerCase() },
      include: [{ model: Utilisateur, as: 'vendeur', attributes: ATTRIBUTS_VENDEUR }],
    });

    if (!boutique || boutique.statut !== 'actif' || boutique.vitrineActive === false) {
      throw new NotFoundError("Cette boutique n'existe pas ou n'est plus en ligne.");
    }
    return boutique;
  }

  /** Filtre commun : ce qu'un visiteur a le droit de voir du catalogue. */
  static _filtreCatalogue(vendeurId) {
    return { vendeurId, statut: 'approuve' };
  }

  // ══════════════════════════════════════════════════════════════════
  //  PAGE D'ACCUEIL DE LA BOUTIQUE
  // ══════════════════════════════════════════════════════════════════

  static async accueil(slug) {
    const boutique = await VitrineService._chargerBoutique(slug);
    const where = VitrineService._filtreCatalogue(boutique.vendeurId);

    const [produits, total, categoriesBrutes, avis, nouveautes] = await Promise.all([
      // Les produits mis en avant : ce qui se vend d'abord. Un catalogue
      // trié par date met en tête ce que le vendeur a saisi en dernier,
      // pas ce que ses clients achètent.
      Produit.findAll({
        where: { ...where, disponible: true },
        include: [{ model: Categorie, as: 'categorie', attributes: ['id', 'nom'] }],
        attributes: ATTRIBUTS_PRODUIT,
        order: [['nombre_ventes', 'DESC'], ['vues', 'DESC'], ['createdAt', 'DESC']],
        limit: LIMITE_DEFAUT,
      }),
      Produit.count({ where }),
      // Seules les catégories qui contiennent réellement quelque chose : un
      // filtre qui ne renvoie rien fait douter le visiteur du site entier.
      Produit.findAll({
        where: { ...where, disponible: true },
        attributes: ['categorieId', [fn('COUNT', col('Produit.id')), 'nombre']],
        include: [{ model: Categorie, as: 'categorie', attributes: ['id', 'nom'] }],
        group: ['Produit.categorie_id', 'categorie.id', 'categorie.nom'],
        raw: true,
        nest: true,
      }),
      Avis.findAll({
        where: { boutiqueId: boutique.id },
        include: [{ model: Utilisateur, as: 'acheteur', attributes: ['nom', 'prenom'] }],
        order: [['createdAt', 'DESC']],
        limit: 6,
      }),
      Produit.findAll({
        where: { ...where, disponible: true },
        include: [{ model: Categorie, as: 'categorie', attributes: ['id', 'nom'] }],
        attributes: ATTRIBUTS_PRODUIT,
        order: [['createdAt', 'DESC']],
        // Large exprès : les produits déjà mis en avant sont retirés juste
        // après, et il doit en rester quelque chose.
        limit: LIMITE_DEFAUT + 8,
      }),
    ]);

    // Une boutique qui vient d'ouvrir a six produits. Sans ce retrait, « Les
    // plus demandés » et « Nouveautés » affichent la même chose, et le site
    // paraît tourner en boucle. La section disparaît d'elle-même côté front
    // quand il ne reste rien à y montrer.
    const idsEnAvant = new Set(produits.map((p) => p.id));
    const nouveautesInedites = nouveautes.filter((p) => !idsEnAvant.has(p.id)).slice(0, 8);

    const notes = avis.map((a) => a.note);
    const noteMoyenne = notes.length
      ? Math.round((notes.reduce((s, n) => s + n, 0) / notes.length) * 10) / 10
      : null;

    return {
      boutique: VitrineService._exposerBoutique(boutique, {
        stats: { produits: total, avis: notes.length, note: noteMoyenne },
      }),
      categories: categoriesBrutes
        .filter((c) => c.categorie && c.categorie.id)
        .map((c) => ({ id: c.categorie.id, nom: c.categorie.nom, nombre: Number(c.nombre) })),
      produitsVedettes: produits.map(VitrineService._exposerProduit),
      nouveautes: nouveautesInedites.map(VitrineService._exposerProduit),
      avis: avis.map((a) => ({
        id: a.id,
        note: a.note,
        commentaire: a.commentaire,
        date: a.createdAt,
        // Prénom + initiale : de quoi rendre l'avis crédible sans publier
        // l'identité complète d'un client.
        auteur: a.acheteur
          ? `${a.acheteur.prenom || ''} ${(a.acheteur.nom || '').charAt(0)}.`.trim()
          : 'Client',
      })),
    };
  }

  // ══════════════════════════════════════════════════════════════════
  //  CATALOGUE
  // ══════════════════════════════════════════════════════════════════

  static async listerProduits(slug, { q, categorie, tri = 'pertinence', page = 1, limit = LIMITE_DEFAUT } = {}) {
    const boutique = await VitrineService._chargerBoutique(slug);

    const l = Math.min(Math.max(parseInt(limit, 10) || LIMITE_DEFAUT, 1), LIMITE_MAX);
    const p = Math.max(parseInt(page, 10) || 1, 1);

    const where = VitrineService._filtreCatalogue(boutique.vendeurId);

    if (q && String(q).trim()) {
      // iLike et non une recherche plein texte : le catalogue d'une boutique
      // se compte en dizaines de produits, un index tsvector n'apporterait
      // rien et coûterait une colonne à maintenir.
      const motif = `%${String(q).trim().slice(0, 60)}%`;
      where[Op.or] = [
        { nom: { [Op.iLike]: motif } },
        { description: { [Op.iLike]: motif } },
        { marque: { [Op.iLike]: motif } },
      ];
    }

    if (categorie && /^[0-9a-f-]{36}$/i.test(String(categorie))) {
      where.categorieId = categorie;
    }

    const ORDRES = {
      pertinence: [['disponible', 'DESC'], ['nombre_ventes', 'DESC'], ['createdAt', 'DESC']],
      nouveaute:  [['createdAt', 'DESC']],
      prix_asc:   [['prix', 'ASC']],
      prix_desc:  [['prix', 'DESC']],
      populaire:  [['vues', 'DESC']],
    };

    const { rows, count } = await Produit.findAndCountAll({
      where,
      include: [{ model: Categorie, as: 'categorie', attributes: ['id', 'nom'] }],
      attributes: ATTRIBUTS_PRODUIT,
      order: ORDRES[tri] || ORDRES.pertinence,
      limit: l,
      offset: (p - 1) * l,
      distinct: true,
    });

    return {
      produits: rows.map(VitrineService._exposerProduit),
      total: count,
      page: p,
      pages: Math.ceil(count / l) || 1,
    };
  }

  // ══════════════════════════════════════════════════════════════════
  //  FICHE PRODUIT
  // ══════════════════════════════════════════════════════════════════

  static async getProduit(slug, produitId) {
    const boutique = await VitrineService._chargerBoutique(slug);

    if (!/^[0-9a-f-]{36}$/i.test(String(produitId || ''))) {
      throw new NotFoundError("Ce produit n'existe pas.");
    }

    const produit = await Produit.findOne({
      // Le vendeurId dans le WHERE, pas seulement l'id : sans lui, l'adresse
      // d'une boutique servirait à lire le produit d'une autre.
      where: { id: produitId, ...VitrineService._filtreCatalogue(boutique.vendeurId) },
      attributes: ATTRIBUTS_PRODUIT,
      include: [
        { model: Categorie, as: 'categorie', attributes: ['id', 'nom'] },
        { model: ProduitImage, as: 'images', attributes: ['id', 'url', 'ordre'] },
      ],
      order: [[{ model: ProduitImage, as: 'images' }, 'ordre', 'ASC']],
    });

    if (!produit) throw new NotFoundError("Ce produit n'existe pas ou n'est plus en vente.");

    // Compteur de vues — best-effort : une visite perdue ne doit pas faire
    // échouer l'affichage de la fiche.
    Produit.increment('vues', { where: { id: produit.id } }).catch(() => {});

    const similaires = await Produit.findAll({
      where: {
        ...VitrineService._filtreCatalogue(boutique.vendeurId),
        categorieId: produit.categorieId,
        id: { [Op.ne]: produit.id },
        disponible: true,
      },
      attributes: ATTRIBUTS_PRODUIT,
      include: [{ model: Categorie, as: 'categorie', attributes: ['id', 'nom'] }],
      order: [['nombre_ventes', 'DESC']],
      limit: 4,
    });

    return {
      boutique: VitrineService._exposerBoutique(boutique),
      produit: VitrineService._exposerProduit(produit),
      similaires: similaires.map(VitrineService._exposerProduit),
    };
  }

  // ══════════════════════════════════════════════════════════════════
  //  PASSAGE EN CAISSE — SANS COMPTE
  // ══════════════════════════════════════════════════════════════════

  /**
   * Normalise un numéro sénégalais pour en faire une clé de recherche
   * stable : « 77 123 45 67 », « +221771234567 » et « 00221771234567 »
   * désignent la même personne et doivent retomber sur le même compte.
   */
  static normaliserTelephone(brut) {
    let t = String(brut || '').replace(/[^0-9+]/g, '');
    if (t.startsWith('00')) t = `+${t.slice(2)}`;
    if (!t.startsWith('+')) {
      // Neuf chiffres : numéro local sénégalais, on préfixe l'indicatif.
      if (/^\d{9}$/.test(t)) t = `+221${t}`;
      else if (/^221\d{9}$/.test(t)) t = `+${t}`;
    }
    return t;
  }

  static estTelephoneValide(tel) {
    return /^\+\d{8,15}$/.test(tel);
  }

  /**
   * Valide et met en forme les coordonnées du client.
   *
   * Aucun compte n'est créé. Le site d'une boutique existe pour épargner au
   * client cette étape : il laisse son nom et son numéro, il commande. Ces
   * coordonnées sont portées par la commande elle-même — c'est tout ce dont
   * le vendeur a besoin pour rappeler et livrer, et c'est aussi la clé de
   * suivi (référence + téléphone).
   *
   * Une version précédente ouvrait un « compte invité » en coulisse, parce
   * que `commande.acheteurId` était obligatoire. Cela fabriquait des comptes
   * que personne n'avait demandés, avec des adresses email inventées, et
   * faisait coexister deux sortes de comptes. La colonne est désormais
   * facultative.
   */
  static _preparerClient({ nom, prenom, telephone, email }) {
    const tel = VitrineService.normaliserTelephone(telephone);
    if (!VitrineService.estTelephoneValide(tel)) {
      throw new BadRequestError('Le numéro de téléphone est invalide. Exemple : 77 123 45 67.');
    }

    const nomNet = String(nom || '').trim().slice(0, 120);
    const prenomNet = String(prenom || '').trim().slice(0, 120);
    if (nomNet.length < 2 || prenomNet.length < 2) {
      throw new BadRequestError('Indiquez votre prénom et votre nom.');
    }

    // L'email reste facultatif : l'exiger ferait abandonner des commandes
    // pour une information dont le vendeur n'a pas besoin — il appelle.
    const emailNet = String(email || '').trim().toLowerCase();
    const emailValide = emailNet && /\S+@\S+\.\S+/.test(emailNet) ? emailNet : null;

    return { nom: nomNet, prenom: prenomNet, telephone: tel, email: emailValide };
  }

  /**
   * Commande passée depuis le site d'une boutique.
   *
   * Le calcul des montants, les verrous de stock et la règle « une commande
   * = une boutique » restent chez CommandeService : cette méthode se limite
   * à identifier le client, vérifier que les produits appartiennent bien à
   * CETTE boutique, et marquer la provenance.
   */
  static async creerCommande(slug, payload = {}) {
    const boutique = await VitrineService._chargerBoutique(slug);

    if (boutique.vitrineCommande === false) {
      throw new ForbiddenError("Cette boutique ne prend pas les commandes en ligne. Contactez-la directement.");
    }

    const { client = {}, items, modeLivraison = 'livraison', modePaiement, adresseLivraison, note } = payload;

    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestError('Votre panier est vide.');
    }
    if (items.length > 30) {
      throw new BadRequestError('Un panier ne peut pas dépasser 30 articles différents.');
    }
    if (!['livraison', 'retrait'].includes(modeLivraison)) {
      throw new BadRequestError('Mode de livraison invalide.');
    }
    if (modeLivraison === 'livraison' && !String(adresseLivraison || '').trim()) {
      throw new BadRequestError('Indiquez une adresse de livraison.');
    }

    // Le paiement en ligne suppose une passerelle branchée sur le compte du
    // vendeur ; sur le site public on s'en tient au paiement à la livraison
    // tant que la boutique l'accepte — c'est aussi ce que le marché attend.
    const paiement = modePaiement === 'en_ligne' ? 'en_ligne' : 'a_la_livraison';
    if (paiement === 'a_la_livraison' && boutique.vitrinePaiementLivraison === false) {
      throw new BadRequestError("Cette boutique n'accepte pas le paiement à la livraison.");
    }

    // Les produits doivent tous venir de CETTE boutique. CommandeService
    // vérifie déjà qu'ils partagent un vendeur, mais pas lequel : sans ce
    // contrôle, le site d'un vendeur servirait à commander chez un autre.
    const ids = [...new Set(items.map((i) => i && i.produitId).filter(Boolean))];
    if (ids.length === 0) throw new BadRequestError('Votre panier est vide.');

    const nbValides = await Produit.count({
      where: { id: { [Op.in]: ids }, ...VitrineService._filtreCatalogue(boutique.vendeurId) },
    });
    if (nbValides !== ids.length) {
      throw new BadRequestError("Un des articles de votre panier n'est plus vendu par cette boutique.");
    }

    const coordonnees = VitrineService._preparerClient(client);

    const commande = await CommandeService.creerCommande({
      // Pas de compte : la commande porte elle-même les coordonnées.
      acheteurId: null,
      client: coordonnees,
      items,
      modeLivraison,
      modePaiement: paiement,
      adresseLivraison: adresseLivraison ? String(adresseLivraison).trim().slice(0, 240) : null,
      numeroTelephone: coordonnees.telephone,
      note: note ? String(note).trim().slice(0, 500) : null,
      origine: 'vitrine',
    });

    return {
      reference: commande.referenceCommande,
      // Le téléphone repart dans la réponse : c'est la clé de suivi, et le
      // client a pu le saisir sous une autre forme que celle enregistrée.
      telephone: coordonnees.telephone,
      montantProduits: commande.montantProduits,
      fraisLivraison: commande.fraisLivraison,
      montantTotal: commande.montantTotal,
      statut: commande.statut,
      modePaiement: commande.modePaiement,
      modeLivraison: commande.modeLivraison,
      boutique: {
        nom: boutique.nom,
        slug: boutique.slug,
        whatsapp: boutique.whatsapp,
        telephone: boutique.telephone,
      },
    };
  }

  // ══════════════════════════════════════════════════════════════════
  //  SUIVI DE COMMANDE — SANS COMPTE
  // ══════════════════════════════════════════════════════════════════

  /**
   * Le client suit sa commande avec sa référence ET son téléphone.
   *
   * La référence seule ne suffit pas : elle transite par SMS et WhatsApp,
   * elle est courte, et elle finit recopiée dans des conversations. Exiger
   * le numéro du compte lie la consultation à la personne qui a commandé.
   */
  static async suivreCommande(reference, telephone) {
    const ref = String(reference || '').trim().toUpperCase().slice(0, 40);
    const tel = VitrineService.normaliserTelephone(telephone);

    if (!ref || !VitrineService.estTelephoneValide(tel)) {
      throw new BadRequestError('Référence ou numéro de téléphone manquant.');
    }

    const commande = await Commande.findOne({
      where: { referenceCommande: ref },
      include: [
        { model: LigneCommande, as: 'lignes' },
        // Facultatif : une commande venue du site n'a pas d'acheteur.
        { model: Utilisateur, as: 'acheteur', attributes: ['id', 'telephone'], required: false },
      ],
    });

    // Référence inconnue et téléphone qui ne correspond pas donnent la même
    // réponse : sinon on saurait, en tâtonnant, quelles références existent.
    // Trois sources possibles pour le numéro : le compte (commande passée
    // dans l'application), les coordonnées du client (site), et le numéro de
    // livraison saisi.
    const correspond = commande && [
      commande.acheteur && commande.acheteur.telephone,
      commande.clientTelephone,
      commande.numeroTelephone,
    ].some((numero) => numero === tel);
    if (!correspond) {
      throw new NotFoundError('Aucune commande ne correspond à cette référence et à ce numéro.');
    }

    const boutique = await Boutique.findOne({
      where: { vendeurId: commande.vendeurId },
      attributes: ['nom', 'slug', 'logo', 'telephone', 'whatsapp'],
    });

    return {
      reference: commande.referenceCommande,
      statut: commande.statut,
      statutPaiement: commande.statutPaiement,
      modeLivraison: commande.modeLivraison,
      modePaiement: commande.modePaiement,
      adresseLivraison: commande.adresseLivraison,
      montantProduits: commande.montantProduits,
      fraisLivraison: commande.fraisLivraison,
      montantTotal: commande.montantTotal,
      date: commande.createdAt,
      lignes: commande.lignes.map((l) => ({
        nom: l.nomProduit,
        image: l.imageProduit,
        prixUnitaire: l.prixUnitaire,
        quantite: l.quantite,
        sousTotal: l.sousTotal,
      })),
      boutique: boutique ? boutique.get({ plain: true }) : null,
    };
  }

  // ══════════════════════════════════════════════════════════════════
  //  COMPTEUR DE VISITES
  // ══════════════════════════════════════════════════════════════════

  /**
   * Une visite du site. Best-effort et silencieux : le compteur sert à
   * montrer au vendeur que sa vitrine tourne, il ne vaut pas de casser
   * l'affichage d'une page.
   */
  static async enregistrerVisite(slug) {
    try {
      await Boutique.increment('vitrineVues', { where: { slug: String(slug || '').toLowerCase() } });
    } catch (err) {
      logger.warn('[vitrine] visite non comptée', { message: err.message });
    }
    return { ok: true };
  }
}

module.exports = VitrineService;
module.exports.MODELES_VITRINE = MODELES_VITRINE;
