const {
  Produit, Boutique, Utilisateur, Favori, Avis, PreferenceClient,
} = require('../../models');
const { Op, Sequelize, fn, col } = require('sequelize');
const logger = require('../../utils/logger');

/**
 * Accueil personnalisé, orienté BOUTIQUES.
 *
 * L'accueil historique (`AcheteurService.accueil`) listait d'abord des
 * produits. Ici on présente d'abord des boutiques — c'est ce qu'on choisit
 * dans une marketplace locale — et les produits n'apparaissent que pour les
 * boutiques auxquelles le client est abonné.
 *
 * La sélection doit bouger dans le temps. Trois leviers :
 *   1. les centres d'intérêt déclarés (à l'inscription, modifiables) ;
 *   2. les affinités, recalculées à chaque geste réel (consultation d'un
 *      produit, recherche, abonnement, achat) ;
 *   3. une rotation quotidienne, pour qu'un client qui ne fait rien de
 *      spécial ne retrouve pas exactement le même écran chaque matin.
 */

// Poids d'un geste dans le calcul d'affinité. Un achat pèse beaucoup plus
// qu'une simple consultation : c'est le signal le moins ambigu.
const POIDS = {
  vue: 1,
  recherche: 2,
  abonnement: 5,
  achat: 10,
};

// Les affinités s'érodent : sans quoi un intérêt d'il y a six mois pèserait
// autant qu'un intérêt d'hier, et l'accueil se figerait.
const DECROISSANCE = 0.98;

const MAX_RECHERCHES = 20;
const RAYON_DEFAUT_KM = 10;

class AccueilService {
  // ==========================================================
  // PRÉFÉRENCES
  // ==========================================================

  /** Crée la ligne à la volée : tout client connecté en a une. */
  static async _preferences(utilisateurId) {
    const [pref] = await PreferenceClient.findOrCreate({
      where: { utilisateurId },
      defaults: { utilisateurId },
    });
    return pref;
  }

  static async getPreferences(utilisateurId) {
    const pref = await this._preferences(utilisateurId);
    return {
      interets: pref.interets || [],
      position: pref.latitude && pref.longitude
        ? { latitude: Number(pref.latitude), longitude: Number(pref.longitude), ville: pref.ville }
        : null,
      recherchesRecentes: pref.recherchesRecentes || [],
    };
  }

  /**
   * Mise à jour depuis l'application : centres d'intérêt choisis à
   * l'inscription, ou position transmise après acceptation de la
   * géolocalisation. Les deux sont indépendants et facultatifs.
   */
  static async majPreferences(utilisateurId, { interets, latitude, longitude, ville }) {
    const pref = await this._preferences(utilisateurId);
    const champs = {};

    if (Array.isArray(interets)) {
      champs.interets = interets.filter((i) => typeof i === 'string').slice(0, 12);
      // Les centres d'intérêt déclarés amorcent les affinités, sinon un
      // nouveau client verrait un accueil totalement générique.
      const affinites = { ...(pref.affinites || {}) };
      champs.interets.forEach((cat) => {
        affinites[cat] = Math.max(affinites[cat] || 0, POIDS.abonnement);
      });
      champs.affinites = affinites;
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      champs.latitude = lat;
      champs.longitude = lng;
      champs.positionMajLe = new Date();
    }
    if (typeof ville === 'string' && ville.trim()) champs.ville = ville.trim();

    await pref.update(champs);
    return this.getPreferences(utilisateurId);
  }

  /**
   * Enregistre un geste et fait évoluer l'affinité de la catégorie.
   * Appelé sans await par les autres services : un échec ici ne doit
   * jamais faire échouer l'action de l'utilisateur.
   */
  static async enregistrerAffinite(utilisateurId, categorie, type = 'vue') {
    if (!utilisateurId || !categorie) return;
    try {
      const pref = await this._preferences(utilisateurId);
      const affinites = { ...(pref.affinites || {}) };

      // Érosion de l'existant, puis ajout du geste du jour.
      Object.keys(affinites).forEach((cle) => {
        affinites[cle] = Math.round(affinites[cle] * DECROISSANCE * 100) / 100;
      });
      affinites[categorie] = (affinites[categorie] || 0) + (POIDS[type] || 1);

      await pref.update({ affinites });
    } catch (err) {
      logger.error('accueil.enregistrerAffinite', { message: err.message });
    }
  }

  /** Mémorise une recherche : elle nourrit les suggestions du lendemain. */
  static async enregistrerRecherche(utilisateurId, terme) {
    if (!utilisateurId || !terme || !terme.trim()) return;
    try {
      const pref = await this._preferences(utilisateurId);
      const propre = terme.trim().slice(0, 80);
      const precedentes = (pref.recherchesRecentes || [])
        .filter((r) => r.terme?.toLowerCase() !== propre.toLowerCase());
      await pref.update({
        recherchesRecentes: [{ terme: propre, date: new Date() }, ...precedentes]
          .slice(0, MAX_RECHERCHES),
      });
    } catch (err) {
      logger.error('accueil.enregistrerRecherche', { message: err.message });
    }
  }

  // ==========================================================
  // ACCUEIL
  // ==========================================================

  /**
   * Construit l'accueil.
   *
   * @param {object|null} utilisateur  acheteur connecté, ou null (invité)
   * @param {string[]}    interetsInvite centres d'intérêt transmis par un invité
   * @param {number|null} latitude
   * @param {number|null} longitude
   */
  static async construire({ utilisateur, interetsInvite = [], latitude, longitude }) {
    const utilisateurId = utilisateur?.id || null;

    let interets = interetsInvite;
    let affinites = {};
    let position = { latitude, longitude };

    if (utilisateurId) {
      const pref = await this._preferences(utilisateurId);
      affinites = pref.affinites || {};
      interets = (pref.interets || []).length ? pref.interets : interetsInvite;
      // La position transmise dans la requête est plus fraîche que la
      // dernière enregistrée : elle prime.
      if (position.latitude == null && pref.latitude != null) {
        position = { latitude: Number(pref.latitude), longitude: Number(pref.longitude) };
      }
    } else {
      // Invité : ses choix de l'écran d'accueil font office d'affinités.
      interetsInvite.forEach((cat) => { affinites[cat] = POIDS.abonnement; });
    }

    // Catégories retenues, des plus fortes affinités aux plus faibles.
    const categories = Object.entries(affinites)
      .sort((a, b) => b[1] - a[1])
      .map(([cat]) => cat)
      .slice(0, 6);
    const categoriesRetenues = categories.length ? categories : interets.slice(0, 6);

    const [
      abonnements, pourVous, proches, meilleures, nouvelles, aDecouvrir,
    ] = await Promise.all([
      this._sectionAbonnements(utilisateurId),
      this._boutiquesParCategories(categoriesRetenues, utilisateurId),
      this._boutiquesProches(position.latitude, position.longitude),
      this._meilleuresBoutiques(),
      this._nouvellesBoutiques(),
      this._aDecouvrir(categoriesRetenues),
    ]);

    const sections = [];

    // Les boutiques suivies passent devant tout le reste : c'est la
    // demande explicite du client, pas une suggestion de notre part.
    if (abonnements.produits.length) {
      sections.push({
        cle: 'abonnements',
        titre: 'Chez les boutiques que vous suivez',
        type: 'produits',
        elements: abonnements.produits,
      });
    }
    if (pourVous.length) {
      sections.push({
        cle: 'pourVous',
        titre: 'Sélectionné pour vous',
        sousTitre: categoriesRetenues.slice(0, 3).join(' · '),
        type: 'boutiques',
        elements: pourVous,
      });
    }
    if (proches.length) {
      sections.push({
        cle: 'proches',
        titre: 'Près de chez vous',
        type: 'boutiques',
        elements: proches,
      });
    }
    if (meilleures.length) {
      sections.push({
        cle: 'meilleures',
        titre: 'Les mieux notées',
        type: 'boutiques',
        elements: meilleures,
      });
    }
    if (nouvelles.length) {
      sections.push({
        cle: 'nouvelles',
        titre: 'Nouvelles boutiques',
        type: 'boutiques',
        elements: nouvelles,
      });
    }
    if (aDecouvrir.length) {
      sections.push({
        cle: 'aDecouvrir',
        titre: 'À découvrir',
        sousTitre: 'En dehors de vos habitudes',
        type: 'boutiques',
        elements: aDecouvrir,
      });
    }

    return {
      invite: !utilisateurId,
      interets: categoriesRetenues,
      positionConnue: position.latitude != null,
      sections: this._rotationDuJour(sections, utilisateurId),
    };
  }

  /**
   * Fait tourner l'ordre des sections d'un jour à l'autre.
   *
   * Les deux premières restent en place — ce sont les plus pertinentes et
   * les déplacer désorienterait. Les suivantes sont permutées selon le jour
   * et le client, pour que l'accueil respire sans devenir imprévisible.
   */
  static _rotationDuJour(sections, utilisateurId) {
    if (sections.length <= 3) return sections;

    const jour = Math.floor(Date.now() / 86400000);
    const graine = (utilisateurId || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const decalage = (jour + graine) % (sections.length - 2);

    const tete = sections.slice(0, 2);
    const reste = sections.slice(2);
    return [...tete, ...reste.slice(decalage), ...reste.slice(0, decalage)];
  }

  // ==========================================================
  // SECTIONS
  // ==========================================================

  /** Boutique visible : active, et rattachée à un vendeur non suspendu. */
  static get _boutiqueVisible() {
    return {
      where: { statut: 'actif' },
      include: [{
        model: Utilisateur,
        as: 'vendeur',
        attributes: ['id', 'prenom', 'nom', 'statutValidation'],
        where: { statut: 'actif' },
        required: true,
      }],
    };
  }

  /** Ajoute le badge de confiance sans exposer l'état interne. */
  static _formater(boutique, extra = {}) {
    const brut = boutique.toJSON ? boutique.toJSON() : boutique;
    return {
      id: brut.id,
      nom: brut.nom,
      slug: brut.slug,
      logo: brut.logo,
      banniere: brut.banniere,
      categorie: brut.categorie,
      localisation: brut.localisation || brut.ville,
      slogan: brut.slogan,
      verifiee: brut.vendeur?.statutValidation === 'approuve',
      ...extra,
    };
  }

  /** Derniers produits publiés par les boutiques suivies. */
  static async _sectionAbonnements(utilisateurId) {
    if (!utilisateurId) return { produits: [] };

    const favoris = await Favori.findAll({
      where: { acheteurId: utilisateurId },
      attributes: ['boutiqueId'],
    });
    if (!favoris.length) return { produits: [] };

    const boutiques = await Boutique.findAll({
      where: { id: { [Op.in]: favoris.map((f) => f.boutiqueId) }, statut: 'actif' },
      attributes: ['id', 'nom', 'logo', 'vendeurId'],
    });
    if (!boutiques.length) return { produits: [] };

    const parVendeur = new Map(boutiques.map((b) => [b.vendeurId, b]));
    const produits = await Produit.findAll({
      where: { vendeurId: { [Op.in]: [...parVendeur.keys()] }, disponible: true },
      order: [['createdAt', 'DESC']],
      limit: 12,
    });

    return {
      produits: produits.map((p) => {
        const brut = p.toJSON();
        const boutique = parVendeur.get(brut.vendeurId);
        return {
          id: brut.id,
          nom: brut.nom,
          prix: brut.prix,
          image: brut.image,
          boutique: boutique ? { id: boutique.id, nom: boutique.nom, logo: boutique.logo } : null,
        };
      }),
    };
  }

  /** Boutiques dont la catégorie correspond aux affinités du client. */
  static async _boutiquesParCategories(categories, utilisateurId) {
    if (!categories.length) return [];

    const base = this._boutiqueVisible;
    const boutiques = await Boutique.findAll({
      ...base,
      where: { ...base.where, categorie: { [Op.in]: categories } },
      limit: 20,
    });

    // Déjà suivies : inutile de les reproposer dans « pour vous ».
    let dejaSuivies = new Set();
    if (utilisateurId) {
      const favoris = await Favori.findAll({
        where: { acheteurId: utilisateurId }, attributes: ['boutiqueId'],
      });
      dejaSuivies = new Set(favoris.map((f) => f.boutiqueId));
    }

    // On respecte l'ordre des affinités : la catégorie la plus forte
    // d'abord, puis une par une, pour éviter un bloc monocatégorie.
    const parCategorie = new Map(categories.map((c) => [c, []]));
    boutiques
      .filter((b) => !dejaSuivies.has(b.id))
      .forEach((b) => parCategorie.get(b.categorie)?.push(b));

    const melange = [];
    let reste = true;
    for (let i = 0; reste && melange.length < 12; i++) {
      reste = false;
      for (const cat of categories) {
        const liste = parCategorie.get(cat) || [];
        if (liste[i]) { melange.push(liste[i]); reste = true; }
      }
    }
    return melange.slice(0, 12).map((b) => this._formater(b));
  }

  /** Boutiques les plus proches, si la position est connue. */
  static async _boutiquesProches(latitude, longitude, rayonKm = RAYON_DEFAUT_KM) {
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return [];
    }

    // Coordonnées validées ci-dessus avant interpolation dans le littéral.
    const distance = Sequelize.literal(`
      6371 * acos(
        LEAST(1, GREATEST(-1,
          cos(radians(${lat})) * cos(radians(CAST(latitude AS float))) *
          cos(radians(CAST(longitude AS float)) - radians(${lng})) +
          sin(radians(${lat})) * sin(radians(CAST(latitude AS float)))
        ))
      )
    `);

    const base = this._boutiqueVisible;
    const boutiques = await Boutique.findAll({
      ...base,
      attributes: { include: [[distance, 'distance']] },
      where: {
        ...base.where,
        latitude: { [Op.ne]: null },
        longitude: { [Op.ne]: null },
      },
      order: [[Sequelize.literal('distance'), 'ASC']],
      limit: 12,
    });

    return boutiques
      .filter((b) => Number(b.get('distance')) <= rayonKm)
      .map((b) => this._formater(b, {
        distanceKm: Math.round(Number(b.get('distance')) * 10) / 10,
      }));
  }

  /** Meilleures notes, à partir d'au moins trois avis. */
  static async _meilleuresBoutiques() {
    const notes = await Avis.findAll({
      attributes: [
        'boutiqueId',
        [fn('AVG', col('note')), 'moyenne'],
        [fn('COUNT', col('id')), 'total'],
      ],
      group: ['boutiqueId'],
      having: Sequelize.literal('COUNT(id) >= 3'),
      order: [[Sequelize.literal('AVG(note)'), 'DESC']],
      limit: 12,
      raw: true,
    });
    if (!notes.length) return [];

    const base = this._boutiqueVisible;
    const boutiques = await Boutique.findAll({
      ...base,
      where: { ...base.where, id: { [Op.in]: notes.map((n) => n.boutiqueId) } },
    });

    const parId = new Map(notes.map((n) => [n.boutiqueId, n]));
    return boutiques
      .map((b) => this._formater(b, {
        note: Math.round(Number(parId.get(b.id).moyenne) * 10) / 10,
        nombreAvis: Number(parId.get(b.id).total),
      }))
      .sort((a, b) => b.note - a.note);
  }

  static async _nouvellesBoutiques() {
    const base = this._boutiqueVisible;
    const boutiques = await Boutique.findAll({
      ...base,
      order: [['createdAt', 'DESC']],
      limit: 10,
    });
    return boutiques.map((b) => this._formater(b));
  }

  /**
   * Boutiques hors des catégories habituelles du client.
   * Sans cette section, l'accueil se referme peu à peu sur trois catégories
   * et le client ne découvre plus rien.
   */
  static async _aDecouvrir(categoriesConnues) {
    const base = this._boutiqueVisible;
    const boutiques = await Boutique.findAll({
      ...base,
      where: {
        ...base.where,
        ...(categoriesConnues.length
          ? { categorie: { [Op.notIn]: categoriesConnues } }
          : {}),
      },
      order: Sequelize.literal('RANDOM()'),
      limit: 8,
    });
    return boutiques.map((b) => this._formater(b));
  }
}

module.exports = AccueilService;
