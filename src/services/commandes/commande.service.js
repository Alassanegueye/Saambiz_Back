// services/commandes/commande.service.js
const { Commande, LigneCommande, Produit, Utilisateur } = require('../../models');
const sequelize = require('../../config/db');
const ConfigService = require('../config/config.service');
const NotificationService = require('../notifications/notification.service');
const { sendPushToUsers } = require('../push.service');
const { sendNouvelleCommandeEmail } = require('../resend.service');
const { BadRequestError, ForbiddenError, NotFoundError } = require('../../errors/AppError');

// Transitions de statut autorisées (qui mène où) — le vendeur fait avancer la commande
const TRANSITIONS = {
  en_attente:     ['confirmee', 'annulee'],
  confirmee:      ['en_preparation', 'annulee'],
  en_preparation: ['prete', 'annulee'],
  prete:          ['en_livraison', 'livree', 'annulee'], // retrait → livree directement
  en_livraison:   ['livree', 'annulee'],
  livree:         [],
  annulee:        [],
};

class CommandeService {

  // -------------------- HELPERS --------------------

  static _genererReference() {
    const annee = new Date().getFullYear();
    const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `CMD-${annee}-${rand}`;
  }

  static async _getFraisLivraison(modeLivraison) {
    if (modeLivraison === 'retrait') return 0;
    // Frais configurables via la table config (clé 'frais_livraison'), défaut 1000 FCFA
    try {
      const cfg = await ConfigService.getConfig('frais_livraison');
      if (cfg && cfg.valeur != null) return parseInt(cfg.valeur, 10) || 0;
    } catch {
      // ignore — on retombe sur le défaut
    }
    return 1000;
  }

  // Décrémente le stock des produits d'une commande (dans une transaction)
  static async _decrementerStock(commande, transaction) {
    const lignes = await LigneCommande.findAll({
      where: { commandeId: commande.id },
      transaction,
    });

    for (const ligne of lignes) {
      if (!ligne.produitId) continue;

      // Verrou pessimiste pour éviter la survente en cas de commandes simultanées
      const produit = await Produit.findByPk(ligne.produitId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!produit) continue;

      if (produit.quantite < ligne.quantite) {
        throw new BadRequestError(`Stock insuffisant pour "${produit.nom}" (reste ${produit.quantite}).`);
      }

      produit.quantite -= ligne.quantite;
      if (produit.quantite === 0) produit.disponible = false;
      await produit.save({ transaction });
    }

    commande.stockDecremente = true;
    await commande.save({ transaction });
  }

  // Restaure le stock (annulation / remboursement)
  static async _restaurerStock(commande, transaction) {
    if (!commande.stockDecremente) return;

    const lignes = await LigneCommande.findAll({
      where: { commandeId: commande.id },
      transaction,
    });

    for (const ligne of lignes) {
      if (!ligne.produitId) continue;
      const produit = await Produit.findByPk(ligne.produitId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!produit) continue;
      produit.quantite += ligne.quantite;
      if (produit.quantite > 0) produit.disponible = true;
      await produit.save({ transaction });
    }

    commande.stockDecremente = false;
    await commande.save({ transaction });
  }

  // -------------------- CRÉER UNE COMMANDE --------------------
  // items: [{ produitId, quantite }]
  static async creerCommande({
    // Nul pour une commande venue du site d'une boutique : le client n'a pas
    // de compte, et c'est le but même de ce site. Ses coordonnées arrivent
    // alors dans `client`.
    acheteurId = null,
    client = null,
    items,
    modeLivraison = 'livraison',
    modePaiement = 'en_ligne',
    adresseLivraison = null,
    numeroTelephone = null,
    note = null,
    // 'application' (mobile), 'vitrine' (le site web de la boutique) ou
    // 'dashboard'. C'est ce qui dit au vendeur si son site lui rapporte.
    origine = 'application',
  }) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestError('La commande doit contenir au moins un produit.');
    }

    const t = await sequelize.transaction();
    try {
      // 1) Charger et valider tous les produits
      const lignesData = [];
      let vendeurId = null;
      let montantProduits = 0;

      for (const item of items) {
        const quantite = parseInt(item.quantite, 10);
        if (!item.produitId || !quantite || quantite < 1) {
          throw new BadRequestError('Chaque article doit avoir un produitId et une quantité valide.');
        }

        const produit = await Produit.findByPk(item.produitId, {
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
        if (!produit) throw new BadRequestError(`Produit introuvable : ${item.produitId}`);
        if (!produit.disponible) throw new BadRequestError(`Le produit "${produit.nom}" n'est pas disponible.`);
        if (produit.quantite < quantite) {
          throw new BadRequestError(`Stock insuffisant pour "${produit.nom}" (reste ${produit.quantite}).`);
        }

        // Une commande = un seul vendeur (on refuse le panier multi-boutiques)
        if (vendeurId === null) {
          vendeurId = produit.vendeurId;
        } else if (vendeurId !== produit.vendeurId) {
          throw new BadRequestError('Tous les produits d\'une commande doivent venir de la même boutique.');
        }

        // `prix_promo` est le prix soldé, `prix` le prix barré (voir le
        // modèle Produit). On facture donc le premier quand il est
        // renseigné et inférieur : la vitrine et l'application affichent le
        // prix soldé, prélever le prix plein serait annoncer un montant et
        // en encaisser un autre.
        const prixCatalogue = parseFloat(produit.prix);
        const prixSolde = produit.prix_promo != null ? parseFloat(produit.prix_promo) : null;
        const prixUnitaire = (prixSolde != null && prixSolde > 0 && prixSolde < prixCatalogue)
          ? prixSolde
          : prixCatalogue;
        const sousTotal = prixUnitaire * quantite;
        montantProduits += sousTotal;

        lignesData.push({
          produitId: produit.id,
          nomProduit: produit.nom,
          imageProduit: produit.image,
          prixUnitaire,
          quantite,
          sousTotal,
        });
      }

      // La comparaison ne vaut que pour un acheteur connecté : sans compte, il
      // n'y a rien à confondre avec le vendeur.
      if (acheteurId && vendeurId === acheteurId) {
        throw new BadRequestError('Vous ne pouvez pas commander vos propres produits.');
      }

      if (!acheteurId && !client) {
        throw new BadRequestError('Indiquez vos coordonnées pour passer commande.');
      }

      // 2) Calcul des montants
      const fraisLivraison = await CommandeService._getFraisLivraison(modeLivraison);
      const montantTotal = montantProduits + fraisLivraison;

      // 3) Statut initial selon le mode de paiement
      //    - en_ligne : reste 'en_attente' jusqu'au paiement (stock décrémenté à la confirmation du paiement)
      //    - a_la_livraison : 'confirmee' immédiatement, on réserve le stock tout de suite
      const paiementEnLigne = modePaiement === 'en_ligne';

      const commande = await Commande.create({
        referenceCommande: CommandeService._genererReference(),
        acheteurId,
        // Coordonnées du client sans compte : c'est tout ce que le vendeur
        // aura pour le rappeler et le livrer.
        clientNom: client ? client.nom : null,
        clientPrenom: client ? client.prenom : null,
        clientTelephone: client ? client.telephone : null,
        clientEmail: client ? client.email || null : null,
        vendeurId,
        montantProduits,
        fraisLivraison,
        montantTotal,
        statut: paiementEnLigne ? 'en_attente' : 'confirmee',
        statutPaiement: 'non_paye',
        modeLivraison,
        modePaiement,
        adresseLivraison,
        numeroTelephone,
        note,
        origine,
      }, { transaction: t });

      // 4) Créer les lignes
      for (const l of lignesData) {
        await LigneCommande.create({ ...l, commandeId: commande.id }, { transaction: t });
      }

      // 5) Réserver le stock immédiatement si paiement à la livraison
      if (!paiementEnLigne) {
        await CommandeService._decrementerStock(commande, t);
      }

      await t.commit();

      // 6) Notifier le vendeur (hors transaction)
      CommandeService._notifierVendeurNouvelleCommande(commande).catch(() => {});

      return await CommandeService.getCommandeComplete(commande.id);

    } catch (err) {
      await t.rollback();
      throw err;
    }
  }

  // -------------------- MARQUER PAYÉE (appelé par le webhook paiement) --------------------
  static async marquerCommandePayee(commandeId, externalTransaction = null) {
    const t = externalTransaction || await sequelize.transaction();
    const gererTransaction = !externalTransaction;
    try {
      const commande = await Commande.findByPk(commandeId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!commande) throw new NotFoundError('Commande introuvable');

      // Idempotence
      if (commande.statutPaiement === 'paye') {
        if (gererTransaction) await t.commit();
        return commande;
      }

      commande.statutPaiement = 'paye';
      if (commande.statut === 'en_attente') commande.statut = 'confirmee';
      await commande.save({ transaction: t });

      // Décrémenter le stock maintenant (si pas déjà fait)
      if (!commande.stockDecremente) {
        await CommandeService._decrementerStock(commande, t);
      }

      if (gererTransaction) await t.commit();

      CommandeService._notifierVendeurNouvelleCommande(commande, true).catch(() => {});
      return commande;

    } catch (err) {
      if (gererTransaction) await t.rollback();
      throw err;
    }
  }

  // -------------------- LISTES --------------------

  static async mesCommandes(acheteurId, { statut } = {}) {
    const where = { acheteurId };
    if (statut) where.statut = statut;
    return await Commande.findAll({
      where,
      include: [
        { model: LigneCommande, as: 'lignes' },
        { model: Utilisateur, as: 'vendeur', attributes: ['id', 'nom', 'prenom', 'telephone'] },
      ],
      order: [['createdAt', 'DESC']],
    });
  }

  static async commandesVendeur(vendeurId, { statut, origine } = {}) {
    const where = { vendeurId };
    if (statut) where.statut = statut;
    // 'application' | 'vitrine' | 'dashboard' — le vendeur veut pouvoir
    // regarder ce que son site lui apporte, séparément du reste.
    if (origine) where.origine = origine;
    const commandes = await Commande.findAll({
      where,
      include: [
        { model: LigneCommande, as: 'lignes' },
        // `required: false` : une commande venue du site d'une boutique n'a
        // pas d'acheteur. Sans cela, Sequelize passerait en jointure interne
        // et ces commandes disparaîtraient de la liste du vendeur.
        { model: Utilisateur, as: 'acheteur', attributes: ['id', 'nom', 'prenom', 'telephone'], required: false },
      ],
      order: [['createdAt', 'DESC']],
    });

    return commandes.map(CommandeService.avecClient);
  }

  /**
   * Ajoute un bloc `client` uniforme à une commande.
   *
   * Le vendeur ne doit pas avoir à savoir si son client a un compte ou non :
   * il veut un nom et un numéro pour préparer et livrer. Les coordonnées
   * viennent du compte quand il y en a un, de la commande sinon.
   */
  static avecClient(commande) {
    const c = commande.get ? commande.get({ plain: true }) : commande;
    const compte = c.acheteur;

    return {
      ...c,
      client: {
        nom: compte ? compte.nom : c.clientNom,
        prenom: compte ? compte.prenom : c.clientPrenom,
        telephone: compte ? compte.telephone : (c.clientTelephone || c.numeroTelephone),
        email: compte ? compte.email : c.clientEmail,
        // Le vendeur peut vouloir le savoir : un client sans compte ne
        // recevra pas de notification, il faudra l'appeler.
        aUnCompte: Boolean(compte),
      },
    };
  }

  static async getCommandeComplete(commandeId) {
    return await Commande.findByPk(commandeId, {
      include: [
        { model: LigneCommande, as: 'lignes' },
        { model: Utilisateur, as: 'acheteur', attributes: ['id', 'nom', 'prenom', 'telephone', 'adresse'] },
        { model: Utilisateur, as: 'vendeur', attributes: ['id', 'nom', 'prenom', 'telephone'] },
      ],
    });
  }

  // Récupère une commande en vérifiant que l'utilisateur y a accès (acheteur ou vendeur)
  static async getCommandePourUtilisateur(commandeId, userId) {
    const commande = await CommandeService.getCommandeComplete(commandeId);
    if (!commande) throw new NotFoundError('Commande introuvable');
    if (commande.acheteurId !== userId && commande.vendeurId !== userId) {
      throw new ForbiddenError('Accès refusé à cette commande');
    }
    return commande;
  }

  // -------------------- CHANGER LE STATUT (vendeur) --------------------
  static async changerStatut(commandeId, vendeurId, nouveauStatut) {
    const commande = await Commande.findByPk(commandeId);
    if (!commande) throw new NotFoundError('Commande introuvable');
    if (commande.vendeurId !== vendeurId) {
      throw new ForbiddenError('Cette commande ne vous appartient pas');
    }

    const autorises = TRANSITIONS[commande.statut] || [];
    if (!autorises.includes(nouveauStatut)) {
      throw new BadRequestError(`Transition impossible : ${commande.statut} → ${nouveauStatut}`);
    }

    if (nouveauStatut === 'annulee') {
      return await CommandeService._annuler(commande, 'vendeur');
    }

    commande.statut = nouveauStatut;
    await commande.save();

    // À la livraison : incrémenter le compteur de ventes des produits (tri "meilleures ventes")
    if (nouveauStatut === 'livree') {
      CommandeService._incrementerVentes(commande.id).catch(() => {});
    }

    // Notifier l'acheteur de l'avancement
    CommandeService._notifierAcheteurStatut(commande).catch(() => {});
    return commande;
  }

  // Incrémente nombre_ventes de chaque produit d'après les quantités commandées
  static async _incrementerVentes(commandeId) {
    const lignes = await LigneCommande.findAll({
      where: { commandeId },
      attributes: ['produitId', 'quantite'],
    });
    for (const ligne of lignes) {
      if (!ligne.produitId) continue;
      await Produit.increment('nombre_ventes', {
        by: ligne.quantite || 1,
        where: { id: ligne.produitId },
      });
    }
  }

  // -------------------- ANNULER (acheteur) --------------------
  static async annulerCommande(commandeId, acheteurId) {
    const commande = await Commande.findByPk(commandeId);
    if (!commande) throw new NotFoundError('Commande introuvable');
    if (commande.acheteurId !== acheteurId) {
      throw new ForbiddenError('Cette commande ne vous appartient pas');
    }
    // L'acheteur ne peut annuler que tant que ce n'est pas en livraison/livrée
    if (!['en_attente', 'confirmee', 'en_preparation'].includes(commande.statut)) {
      throw new BadRequestError('Cette commande ne peut plus être annulée.');
    }
    return await CommandeService._annuler(commande, 'acheteur');
  }

  static async _annuler(commande, parQui) {
    const t = await sequelize.transaction();
    try {
      // Restaurer le stock si réservé
      await CommandeService._restaurerStock(commande, t);

      commande.statut = 'annulee';
      if (commande.statutPaiement === 'paye') {
        commande.statutPaiement = 'rembourse'; // le remboursement réel via PSP reste à déclencher
      }
      await commande.save({ transaction: t });

      await t.commit();

      // Notifier l'autre partie
      if (parQui === 'vendeur') {
        CommandeService._notifierAcheteurStatut(commande, 'Votre commande a été annulée par le vendeur.').catch(() => {});
      } else {
        CommandeService._notifierUtilisateur(
          commande.vendeurId,
          'Commande annulée',
          `La commande ${commande.referenceCommande} a été annulée par l'acheteur.`,
        ).catch(() => {});
      }
      return commande;
    } catch (err) {
      await t.rollback();
      throw err;
    }
  }

  // -------------------- NOTIFICATIONS --------------------

  static async _notifierUtilisateur(utilisateurId, titre, message) {
    await NotificationService.creerNotification({
      utilisateurId, titre, message, type: 'commande',
    });
    sendPushToUsers(utilisateurId, { title: titre, body: message, data: { type: 'commande' } }).catch(() => {});
  }

  static async _notifierVendeurNouvelleCommande(commande, paiementConfirme = false) {
    const titre = paiementConfirme ? '💰 Commande payée' : '🛒 Nouvelle commande';
    const message = `Commande ${commande.referenceCommande} — ${commande.montantTotal} FCFA.`;
    await CommandeService._notifierUtilisateur(commande.vendeurId, titre, message);
    Utilisateur.findByPk(commande.vendeurId).then(vendeur => vendeur && sendNouvelleCommandeEmail({ to: vendeur.email, nom: `${vendeur.prenom || ''} ${vendeur.nom || ''}`.trim(), referenceCommande: commande.referenceCommande, montantTotal: commande.montantTotal })).catch(() => {});
  }

  static async _notifierAcheteurStatut(commande, messagePerso = null) {
    // Commande passée sans compte, depuis le site d'une boutique : il n'y a
    // personne à notifier dans l'application. Le client suit sa commande avec
    // sa référence et son numéro, et le vendeur l'appelle.
    if (!commande.acheteurId) return;

    const libelles = {
      confirmee: 'Votre commande est confirmée.',
      en_preparation: 'Votre commande est en préparation.',
      prete: 'Votre commande est prête.',
      en_livraison: 'Votre commande est en cours de livraison.',
      livree: 'Votre commande a été livrée. Merci pour votre achat !',
      annulee: 'Votre commande a été annulée.',
    };
    const message = messagePerso || libelles[commande.statut] || `Statut : ${commande.statut}`;
    await CommandeService._notifierUtilisateur(
      commande.acheteurId,
      `Commande ${commande.referenceCommande}`,
      message,
    );
  }
}

module.exports = CommandeService;
