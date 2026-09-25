const { Produit, Categorie, Utilisateur, Boutique, Abonnement, Favori, Promotion, Message, Notification, ProduitImage } = require('../../models');
const logger = require('../../utils/logger');
const { Op, Sequelize, fn, col, literal } = require('sequelize');
const sequelize = require('../../config/db');
const includeVendeurActif = require('../../utils/includeVendeurActif');

const LIMIT = 15;

const paginate = (page = 1) => ({
  limit: LIMIT,
  offset: (page - 1) * LIMIT
});

class AcheteurService {

  // ==============================
  // ABONNEMENTS : le client ne voit que les produits des boutiques suivies
  // ==============================
  // Retourne les IDs des vendeurs dont l'acheteur suit la boutique.
  static async _vendeurIdsSuivis(acheteurId) {
    if (!acheteurId) return [];
    const favoris = await Favori.findAll({
      where: { acheteurId },
      include: [{ model: Boutique, as: 'boutique', attributes: ['vendeurId'] }],
    });
    return [...new Set(favoris.map(f => f.boutique?.vendeurId).filter(Boolean))];
  }

  // ==============================
  // 1. PRODUITS (boutiques suivies uniquement)
  // ==============================
  static async listerTousProduits(acheteurId, page = 1) {
    try {
      logger.info("📦 [listerTousProduits] page:", page);

      const { limit, offset } = paginate(page);
      const vendeurIds = await this._vendeurIdsSuivis(acheteurId);

      const { rows, count } = await Produit.findAndCountAll({
        limit,
        offset,
        distinct: true,
        where: { quantite: { [Op.gt]: 0 }, vendeurId: { [Op.in]: vendeurIds } },
        include: [
          {
            model: Categorie,
            as: 'categorie',
            attributes: ['id', 'nom']
          },
          includeVendeurActif(),
          { model: ProduitImage, as: 'images', attributes: ['id', 'url', 'ordre'] }
        ],
        order: [['createdAt', 'DESC']]
      });

      logger.info("✅ Produits trouvés:", rows.length);

      return {
        produits: rows,
        total: count,
        page,
        pages: Math.ceil(count / LIMIT)
      };

    } catch (error) {
      logger.error("❌ ERREUR listerTousProduits:", error);
      throw error;
    }
  }

  // ==============================
  // 2. RECHERCHE
  // ==============================
  static async rechercherProduits(acheteurId, query, page = 1) {
    try {
      logger.info("🔎 Recherche:", query);

      const { limit, offset } = paginate(page);

      if (!query || !query.trim()) {
        logger.info("⚠️ Query vide");
        return { produits: [], total: 0, page, pages: 0 };
      }

      const searchTerm = `%${query.trim()}%`;
      const vendeurIds = await this._vendeurIdsSuivis(acheteurId);

      const { rows, count } = await Produit.findAndCountAll({
        limit,
        offset,
        distinct: true,
        where: {
          quantite: { [Op.gt]: 0 },
          vendeurId: { [Op.in]: vendeurIds },
          [Op.or]: [
            { nom: { [Op.iLike]: searchTerm } },
            { '$categorie.nom$': { [Op.iLike]: searchTerm } }
          ]
        },
        include: [
          {
            model: Categorie,
            as: 'categorie',
            attributes: ['id', 'nom']
          },
          includeVendeurActif(),
          { model: ProduitImage, as: 'images', attributes: ['id', 'url', 'ordre'] }
        ],
        order: [['nom', 'ASC']]
      });

      logger.info("🔎 Résultats recherche:", rows.length);

      return {
        produits: rows,
        total: count,
        page,
        pages: Math.ceil(count / LIMIT)
      };

    } catch (error) {
      logger.error("❌ ERREUR rechercherProduits:", error);
      throw error;
    }
  }

  // ==============================
  // 3. FILTRE VILLE
  // ==============================
  static async filtrerParVille(acheteurId, ville, page = 1) {
    try {
      logger.info("🌍 Ville filtre:", ville);

      if (!ville || !ville.trim()) {
        logger.info("⚠️ Ville vide");
        return { produits: [], total: 0, page, pages: 0 };
      }

      const { limit, offset } = paginate(page);
      const villeSearch = `%${ville.trim()}%`;
      const vendeurIds = await this._vendeurIdsSuivis(acheteurId);

      const { rows, count } = await Produit.findAndCountAll({
        limit,
        offset,
        distinct: true,
        where: { quantite: { [Op.gt]: 0 }, vendeurId: { [Op.in]: vendeurIds } },
        include: [
          {
            model: Categorie,
            as: 'categorie',
            attributes: ['id', 'nom']
          },
          {
            ...includeVendeurActif(),
            include: [
              {
                model: Boutique,
                as: 'boutiques',
                required: true,
                where: { localisation: { [Op.iLike]: villeSearch } }
              }
            ]
          },
          { model: ProduitImage, as: 'images', attributes: ['id', 'url', 'ordre'] }
        ],
        order: [['createdAt', 'DESC']]
      });

      logger.info("🌍 Produits ville:", rows.length);

      return {
        produits: rows,
        total: count,
        page,
        ville: ville.trim(),
        pages: Math.ceil(count / LIMIT)
      };

    } catch (error) {
      logger.error("❌ ERREUR filtrerParVille:", error);
      throw error;
    }
  }

  // ==============================
  // 4. WHATSAPP
  // ==============================
  static async contacterVendeurWhatsapp(produitId) {
    try {
      logger.info("📲 WhatsApp produitId:", produitId);

      const now = new Date();

      const produit = await Produit.findByPk(produitId, {
        include: [
          {
            model: Categorie,
            as: 'categorie',
            attributes: ['nom']
          },
          {
            model: Utilisateur,
            as: 'vendeur',
            attributes: ['telephone', 'nom', 'prenom'],
            include: [
              {
                model: Boutique,
                as: 'boutiques',
                attributes: ['telephone', 'localisation']
              },
              {
                model: Abonnement,
                as: 'abonnements',
                required: true,
                where: {
                  statut: 'actif',
                  dateFin: { [Op.gte]: now }
                }
              }
            ]
          }
        ]
      });

      if (!produit) {
        logger.info("❌ Produit introuvable");
        throw new Error('Produit non trouvé ou vendeur inactif');
      }

      logger.info("✅ Produit trouvé");

      let tel =
        produit.vendeur.boutiques?.[0]?.telephone ||
        produit.vendeur.telephone;

      logger.info("📞 Téléphone brut:", tel);

      if (!tel) throw new Error('Téléphone vendeur non disponible');

      tel = tel.replace(/[^0-9+]/g, '');

      if (!tel.startsWith('221')) {
        tel = '221' + tel;
      }

      logger.info("📞 Téléphone final:", tel);

      const message = `
Bonjour ${produit.vendeur.nom || ''} ${produit.vendeur.prenom || ''},

Je suis intéressé par :

🛍️ ${produit.nom}
💰 ${produit.prix} FCFA
📦 ${produit.quantite}
🏷️ ${produit.categorie?.nom || ''}

Merci.
      `.trim();

      const url = `https://wa.me/${tel}?text=${encodeURIComponent(message)}`;

      logger.info("🔗 WhatsApp URL généré");

      return url;

    } catch (error) {
      logger.error("❌ ERREUR WhatsApp:", error);
      throw error;
    }
  }

  // ==============================
  // 5. BOUTIQUES
  // ==============================
  static async listerBoutiques(page = 1) {
    try {
      logger.info("🏪 Liste boutiques page:", page);

      const { limit, offset } = paginate(page);

      const { rows, count } = await Boutique.findAndCountAll({
        limit,
        offset,
        attributes: [
          'id', 'nom', 'slug', 'description', 'slogan', 'localisation',
          'telephone', 'logo', 'banniere', 'couleur_theme', 'categorie'
        ],
        include: [includeVendeurActif()],
        order: [['createdAt', 'DESC']]
      });

      logger.info("🏪 Boutiques trouvées:", rows.length);

      // Injecter la note moyenne + le nombre d'avis de chaque boutique
      const AvisService = require('../avis/avis.service');
      const moyennes = await AvisService.moyennesPourBoutiques(rows.map(b => b.id));
      rows.forEach(b => {
        const m = moyennes[b.id] || { moyenne: 0, total: 0 };
        b.dataValues.note = m.moyenne;
        b.dataValues.nombreAvis = m.total;
      });

      return {
        boutiques: rows,
        total: count,
        page,
        pages: Math.ceil(count / LIMIT)
      };

    } catch (error) {
      logger.error("❌ ERREUR boutiques:", error);
      throw error;
    }
  }

  // ==============================
  // 6. PRODUITS BOUTIQUE
  // ==============================
  static async getProduitsByBoutique(boutiqueId, page = 1) {
    try {
      logger.info("🏬 Boutique ID:", boutiqueId);

      const boutique = await Boutique.findByPk(boutiqueId);

      if (!boutique) {
        logger.info("❌ Boutique introuvable");
        throw new Error('Boutique introuvable');
      }

      const { limit, offset } = paginate(page);

      const { rows, count } = await Produit.findAndCountAll({
        limit,
        offset,
        where: { quantite: { [Op.gt]: 0 } },
        include: [
          {
            model: Categorie,
            as: 'categorie',
            attributes: ['id', 'nom']
          },
          {
            ...includeVendeurActif(),
            include: [
              {
                model: Boutique,
                as: 'boutiques',
                required: true,
                where: { id: boutiqueId }
              }
            ]
          },
          { model: ProduitImage, as: 'images', attributes: ['id', 'url', 'ordre'] }
        ],
        order: [['createdAt', 'DESC']]
      });

      logger.info("🏬 Produits boutique:", rows.length);

      return {
        boutique,
        produits: rows,
        total: count,
        page,
        pages: Math.ceil(count / LIMIT)
      };

    } catch (error) {
      logger.error("❌ ERREUR getProduitsByBoutique:", error);
      throw error;
    }
  }
  // ==============================
  // 7. INCRÉMENTER VUES
  // ==============================
  static async incrementerVues(produitId) {
    await Produit.increment({ vues: 1 }, { where: { id: produitId } });
    return { message: 'Vue enregistrée' };
  }

  // ==============================
  // 8. DÉTAIL PRODUIT
  // ==============================
  static async getDetailProduit(produitId) {
    const now = new Date();
    const produit = await Produit.findByPk(produitId, {
      include: [
        { model: Categorie, as: 'categorie', attributes: ['id', 'nom'] },
        {
          model: Boutique,
          as: 'boutiques',
          attributes: ['id', 'nom', 'logo', 'localisation'],
        },
        {
          model: Promotion,
          as: 'promotions',
          required: false,
          where: { dateFin: { [Op.gte]: now } },
        },
        { model: ProduitImage, as: 'images', attributes: ['id', 'url', 'ordre'] }
      ]
    });
    if (!produit) throw new Error('Produit introuvable');
    return { produit };
  }

  // ==============================
  // 9. DÉTAIL BOUTIQUE
  // ==============================
  static async getDetailBoutique(boutiqueId) {
    const boutique = await Boutique.findByPk(boutiqueId, {
      include: [
        { model: Utilisateur, as: 'vendeur', attributes: ['id', 'nom', 'prenom', 'photoProfil', 'telephone', 'verifie'] },
        {
          model: Produit,
          as: 'produits',
          where: { disponible: true },
          required: false,
          attributes: ['id', 'nom', 'prix', 'prix_promo', 'image', 'vues', 'marque', 'statut'],
          include: [{ model: Categorie, as: 'categorie', attributes: ['id', 'nom'] }]
        },
        { model: Favori, as: 'favoris', attributes: ['id'] }
      ]
    });
    if (!boutique) throw new Error('Boutique introuvable');

    return { boutique, nombreFavoris: boutique.favoris.length, nombreAbonnes: boutique.favoris.length };
  }

  // ==============================
  // LISTE PRODUITS AVEC FILTRES AVANCÉS
  // ==============================
  static async listerProduitsAvecFiltres({ categorieId, prixMin, prixMax, tri, disponible, q, marque, enPromo, acheteurId, page = 1 }) {
    const { limit, offset } = paginate(page);
    const where = {};

    // Ne montre que les produits des boutiques suivies
    const vendeurIds = await this._vendeurIdsSuivis(acheteurId);
    where.vendeurId = { [Op.in]: vendeurIds };

    if (disponible !== undefined) where.disponible = disponible === 'true' || disponible === true;
    else where.quantite = { [Op.gt]: 0 };

    if (categorieId) where.categorieId = categorieId;
    if (q) where.nom = { [Op.iLike]: `%${q}%` };
    if (marque) where.marque = { [Op.iLike]: `%${marque}%` };
    if (enPromo === 'true' || enPromo === true) where.prix_promo = { [Op.ne]: null };
    if (prixMin || prixMax) {
      where.prix = {};
      if (prixMin) where.prix[Op.gte] = parseFloat(prixMin);
      if (prixMax) where.prix[Op.lte] = parseFloat(prixMax);
    }

    const order =
      tri === 'prix_asc'   ? [['prix', 'ASC']] :
      tri === 'prix_desc'  ? [['prix', 'DESC']] :
      tri === 'populaire'  ? [['vues', 'DESC']] :
      tri === 'ventes'     ? [['nombre_ventes', 'DESC']] :
                             [['createdAt', 'DESC']];

    const { rows, count } = await Produit.findAndCountAll({
      where,
      limit,
      offset,
      distinct: true,
      include: [
        { model: Categorie, as: 'categorie', attributes: ['id', 'nom'] },
        includeVendeurActif(),
        { model: ProduitImage, as: 'images', attributes: ['id', 'url', 'ordre'] }
      ],
      order
    });

    return { produits: rows, total: count, page: parseInt(page), pages: Math.ceil(count / LIMIT) };
  }

  // ==============================
  // PRODUITS TENDANCE
  // ==============================
  static async produitsTendance(acheteurId, limite = 10) {
    const dateDebut = new Date();
    dateDebut.setDate(dateDebut.getDate() - 7);

    const vendeurIds = await this._vendeurIdsSuivis(acheteurId);

    const produits = await Produit.findAll({
      where: { disponible: true, vues: { [Op.gt]: 0 }, vendeurId: { [Op.in]: vendeurIds } },
      include: [
        { model: Categorie, as: 'categorie', attributes: ['id', 'nom'] },
        includeVendeurActif(),
        { model: ProduitImage, as: 'images', attributes: ['id', 'url', 'ordre'] }
      ],
      order: [['vues', 'DESC']],
      limit: parseInt(limite)
    });
    return { produits };
  }

  // ==============================
  // DÉCOUVERTE (NON scopé aux abonnements)
  // Amorce un nouvel utilisateur : produits populaires + nouvelles boutiques,
  // toutes boutiques confondues, afin de trouver qui suivre.
  // ==============================
  static async decouverte({ page = 1 } = {}) {
    const { limit, offset } = paginate(page);

    const [produits, nouvellesBoutiques] = await Promise.all([
      Produit.findAndCountAll({
        where: { disponible: true, quantite: { [Op.gt]: 0 } },
        include: [
          { model: Categorie, as: 'categorie', attributes: ['id', 'nom'] },
          includeVendeurActif(),
          { model: ProduitImage, as: 'images', attributes: ['id', 'url', 'ordre'] }
        ],
        order: [['nombre_ventes', 'DESC'], ['vues', 'DESC']],
        distinct: true,
        limit,
        offset,
      }),
      Boutique.findAll({
        where: { statut: 'actif' },
        include: [includeVendeurActif()],
        order: [['createdAt', 'DESC']],
        limit: 10,
      }),
    ]);

    return {
      produitsPopulaires: produits.rows,
      total: produits.count,
      page: parseInt(page),
      pages: Math.ceil(produits.count / LIMIT),
      nouvellesBoutiques,
    };
  }

  // ==============================
  // NOUVELLES BOUTIQUES
  // ==============================
  static async nouvellesBoutiques(limite = 10) {
    const il_y_a_30_jours = new Date();
    il_y_a_30_jours.setDate(il_y_a_30_jours.getDate() - 30);

    const boutiques = await Boutique.findAll({
      where: { createdAt: { [Op.gte]: il_y_a_30_jours } },
      include: [includeVendeurActif()],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limite)
    });
    return { boutiques };
  }

  // ==============================
  // BOUTIQUES VÉRIFIÉES
  // ==============================
  static async boutiquesVerifiees(page = 1) {
    const { limit, offset } = paginate(page);
    const { rows, count } = await Boutique.findAndCountAll({
      include: [{
        model: Utilisateur, as: 'vendeur',
        where: { verifie: true, statut: 'actif' },
        attributes: { exclude: ['mot_de_passe'] }
      }],
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });
    return { boutiques: rows, total: count, page: parseInt(page), pages: Math.ceil(count / LIMIT) };
  }

  // ==============================
  // PROMOTIONS ACTIVES (VUE ACHETEUR)
  // ==============================
  static async promotionsActives(acheteurId, page = 1) {
    const { limit, offset } = paginate(page);
    const now = new Date();
    const vendeurIds = await this._vendeurIdsSuivis(acheteurId);
    const { rows, count } = await Promotion.findAndCountAll({
      where: { active: true, dateFin: { [Op.gte]: now }, vendeurId: { [Op.in]: vendeurIds } },
      include: [
        {
          model: Produit,
          attributes: ['id', 'nom', 'prix', 'image'],
          include: [
            { model: Categorie, as: 'categorie', attributes: ['id', 'nom'] },
            includeVendeurActif()
          ]
        },
        { model: Utilisateur, as: 'vendeur', attributes: ['id', 'nom', 'prenom'],
          include: [{ model: Boutique, as: 'boutiques', attributes: ['id', 'nom', 'logo', 'localisation'] }]
        }
      ],
      order: [['dateFin', 'ASC']],
      limit,
      offset
    });
    return { promotions: rows, total: count, page: parseInt(page), pages: Math.ceil(count / LIMIT) };
  }

  // ==============================
  // RECHERCHE GLOBALE (produits + boutiques)
  // ==============================
  // Les produits sont limités aux boutiques suivies ; la recherche de boutiques
  // reste globale pour permettre la découverte et l'abonnement.
  static async rechercheGlobale(acheteurId, q, page = 1) {
    if (!q || !q.trim()) return { produits: [], boutiques: [], total: 0 };
    const term = `%${q.trim()}%`;
    const { limit, offset } = paginate(page);
    const vendeurIds = await this._vendeurIdsSuivis(acheteurId);

    const [produits, boutiques] = await Promise.all([
      Produit.findAll({
        where: {
          disponible: true,
          vendeurId: { [Op.in]: vendeurIds },
          [Op.or]: [
            { nom: { [Op.iLike]: term } },
            { description: { [Op.iLike]: term } },
            { '$categorie.nom$': { [Op.iLike]: term } }
          ]
        },
        include: [
          { model: Categorie, as: 'categorie', attributes: ['id', 'nom'] },
          includeVendeurActif(),
          { model: ProduitImage, as: 'images', attributes: ['id', 'url', 'ordre'] }
        ],
        limit,
        offset,
        order: [['vues', 'DESC']]
      }),
      Boutique.findAll({
        where: {
          [Op.or]: [
            { nom: { [Op.iLike]: term } },
            { description: { [Op.iLike]: term } },
            { localisation: { [Op.iLike]: term } }
          ]
        },
        include: [includeVendeurActif()],
        limit: 5,
        order: [['createdAt', 'DESC']]
      })
    ]);

    return { produits, boutiques, total: produits.length + boutiques.length };
  }

  // ==============================
  // PAGE ACCUEIL (feed en 1 appel)
  // ==============================
  static async accueil(acheteurId) {
    const [tendance, nouvellesBoutiques, promotions, favoris, notifsNonLues, messagesNonLus] = await Promise.all([
      AcheteurService.produitsTendance(acheteurId, 6),
      AcheteurService.nouvellesBoutiques(4),
      AcheteurService.promotionsActives(acheteurId, 1),
      Favori.findAll({
        where: { acheteurId },
        include: [{ model: Boutique, as: 'boutique', attributes: ['id', 'nom', 'logo', 'localisation'] }],
        limit: 5,
        order: [['createdAt', 'DESC']]
      }),
      Notification.count({ where: { utilisateurId: acheteurId, lue: false } }),
      Message.count({ where: { destinataireId: acheteurId, lu: false } })
    ]);

    return {
      produitsTendance: tendance.produits,
      nouvellesBoutiques: nouvellesBoutiques.boutiques,
      promotionsActives: promotions.promotions.slice(0, 4),
      mesFavorisRecents: favoris,
      alertes: {
        notificationsNonLues: notifsNonLues,
        messagesNonLus
      }
    };
  }

  // ==============================
  // MES CONVERSATIONS (vue acheteur)
  // ==============================
  static async mesConversations(acheteurId) {
    const messages = await Message.findAll({
      where: {
        [Op.or]: [
          { expediteurId: acheteurId },
          { destinataireId: acheteurId }
        ]
      },
      include: [
        { model: Utilisateur, as: 'expediteur', attributes: ['id', 'prenom', 'nom', 'photoProfil', 'role'] },
        { model: Utilisateur, as: 'destinataire', attributes: ['id', 'prenom', 'nom', 'photoProfil', 'role'] }
      ],
      order: [['createdAt', 'DESC']]
    });

    const conversationsMap = new Map();
    for (const msg of messages) {
      const interlocuteurId = msg.expediteurId === acheteurId ? msg.destinataireId : msg.expediteurId;
      if (!conversationsMap.has(interlocuteurId)) {
        const interlocuteur = msg.expediteurId === acheteurId ? msg.destinataire : msg.expediteur;
        conversationsMap.set(interlocuteurId, {
          interlocuteur,
          dernierMessage: { contenu: msg.contenu, date: msg.createdAt, lu: msg.lu },
          nonLus: 0
        });
      }
    }

    const nonLusParConv = await Message.findAll({
      where: { destinataireId: acheteurId, lu: false },
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

  // ==============================
  // TABLEAU DE BORD ACHETEUR
  // ==============================
  static async monTableauDeBord(acheteurId) {
    const [nombreFavoris, messagesNonLus, notifsNonLues, favorisRecents] = await Promise.all([
      Favori.count({ where: { acheteurId } }),
      Message.count({ where: { destinataireId: acheteurId, lu: false } }),
      Notification.count({ where: { utilisateurId: acheteurId, lue: false } }),
      Favori.findAll({
        where: { acheteurId },
        include: [{ model: Boutique, as: 'boutique', attributes: ['id', 'nom', 'logo', 'localisation'] }],
        order: [['createdAt', 'DESC']],
        limit: 5
      })
    ]);

    return {
      stats: { nombreFavoris, messagesNonLus, notificationsNonLues: notifsNonLues },
      boutiquesRecentes: favorisRecents.map(f => f.boutique)
    };
  }

  // ==============================
  // 10. BOUTIQUES PROCHES
  // ==============================
  static async boutiquesProches(lat, lng, rayon = 5) {
    // C-02 : validation stricte pour éviter l'injection SQL via Sequelize.literal()
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    const rayonKm = parseFloat(rayon);

    if (
      isNaN(latitude) || isNaN(longitude) || isNaN(rayonKm) ||
      latitude < -90 || latitude > 90 ||
      longitude < -180 || longitude > 180 ||
      rayonKm <= 0 || rayonKm > 500
    ) {
      throw new Error('Coordonnées GPS ou rayon invalides');
    }

    const distance = Sequelize.literal(`
      6371 * acos(
        cos(radians(${latitude})) * cos(radians(CAST(latitude AS float))) *
        cos(radians(CAST(longitude AS float)) - radians(${longitude})) +
        sin(radians(${latitude})) * sin(radians(CAST(latitude AS float)))
      )
    `);

    const boutiques = await Boutique.findAll({
      attributes: { include: [[distance, 'distance']] },
      where: {
        latitude: { [Op.ne]: null },
        longitude: { [Op.ne]: null },
      },
      having: Sequelize.literal(`6371 * acos(
        cos(radians(${latitude})) * cos(radians(CAST(latitude AS float))) *
        cos(radians(CAST(longitude AS float)) - radians(${longitude})) +
        sin(radians(${latitude})) * sin(radians(CAST(latitude AS float)))
      ) <= ${rayonKm}`),
      order: [[Sequelize.literal('distance'), 'ASC']],
      include: [{ model: Utilisateur, as: 'vendeur', attributes: ['nom', 'prenom'] }]
    });

    return { boutiques };
  }
}

module.exports = AcheteurService;