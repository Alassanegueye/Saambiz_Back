// services/commandes/commande.service.js
const crypto = require('crypto');
const { Commande, LigneCommande, Produit, Utilisateur, Boutique, HistoriqueCommande } = require('../../models');
const sequelize = require('../../config/db');
const ConfigService = require('../config/config.service');
const NotificationService = require('../notifications/notification.service');
const { getIO } = require('../socket.service');
const logger = require('../../utils/logger');
const echecIgnore = require('../../utils/echecIgnore');
const { sendNouvelleCommandeEmail, sendCommandeClientEmail } = require('../resend.service');
const { BadRequestError, ForbiddenError, NotFoundError } = require('../../errors/AppError');
const { normaliserTelephone, erreurTelephone } = require('../../utils/telephone');
const { paginate, metaPagination } = require('../../utils/paginate');
const { paiementEnLigneActif } = require('../../config/security');

/**
 * Un montant tel qu'on le lit sur un écran verrouillé : « 5 500 FCFA ».
 *
 * Sequelize rend un DECIMAL en chaîne : « 5500.00 ». La notification
 * affichait « Commande CMD-2026-LREV6T — 5500.00 FCFA. », avec des centimes
 * que le franc CFA n'a pas et sans séparateur de milliers. L'espace est une
 * espace insécable : un montant ne doit pas se couper en fin de ligne.
 */
function montantLisible(montant) {
  const n = Number(montant);
  if (!Number.isFinite(n)) return `${montant} FCFA`;
  return `${Math.round(n).toLocaleString('fr-FR').replace(/ /g, ' ')} FCFA`;
}

// Transitions de statut autorisées (qui mène où) — le vendeur fait avancer la commande
const TRANSITIONS = {
  en_attente:     ['acceptee', 'rejetee', 'annulee'],
  acceptee:       ['en_preparation', 'annulee'],
  rejetee:        [],
  payee:          ['en_preparation', 'annulee'],
  confirmee:      ['en_preparation', 'annulee'],
  en_preparation: ['prete', 'annulee'],
  prete:          ['en_livraison', 'livree', 'annulee'], // retrait → livree directement
  en_livraison:   ['livree', 'annulee'],
  livree:         [],
  annulee:        [],
};

/**
 * Les mêmes libellés que l'application, pour que le refus d'une transition
 * se lise. « Transition impossible : livree → en_preparation » est une phrase
 * de développeur ; le vendeur, lui, a besoin de savoir où en est sa commande.
 */
const LIBELLES_STATUT = {
  en_attente:     'En attente',
  acceptee:       'Acceptée',
  rejetee:        'Rejetée',
  payee:          'Payée',
  confirmee:      'Confirmée',
  en_preparation: 'En préparation',
  prete:          'Prête',
  en_livraison:   'En livraison',
  livree:         'Livrée',
  annulee:        'Annulée',
};

const libelle = (statut) => LIBELLES_STATUT[statut] || statut;

// Alphabet des références de commande : chiffres et majuscules, c'est-à-dire
// base 36 — le même jeu de caractères qu'avant, pour que les références déjà
// imprimées sur des reçus restent du même genre. Voir `_genererReference`.
const ALPHABET_REFERENCE = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Le vendeur, avec sa boutique : le client reconnaît une commande au nom de
// la boutique, pas à celui de la personne qui la tient. Une fonction plutôt
// qu'un objet partagé : Sequelize annote les `include` qu'on lui passe.
const inclureVendeur = () => ({
  model: Utilisateur,
  as: 'vendeur',
  attributes: ['id', 'nom', 'prenom', 'telephone'],
  include: [{ model: Boutique, as: 'boutiques', attributes: ['id', 'nom', 'logo'], required: false }],
});

class CommandeService {

  // -------------------- HELPERS --------------------

  /**
   * Référence de commande : `CMD-<année>-<6 caractères>`.
   *
   * Tirée par `crypto.randomInt` et non par `Math.random`, pour deux raisons.
   *
   * LA PREMIÈRE est que cette référence est un FACTEUR D'AUTHENTIFICATION.
   * Le suivi de commande sans compte (`GET /vitrine/commande/:reference`) la
   * demande avec le numéro de téléphone du client, et rend la commande : nom,
   * articles, adresse de livraison, montant. `Math.random` n'est pas
   * cryptographique — l'état interne du générateur se reconstitue à partir de
   * quelques tirages observés —, donc un vendeur qui collecte les références
   * de ses propres commandes peut prédire celles qui suivent. Il resterait le
   * téléphone à deviner, et le plafond de 40 essais par dix minutes ; mais on
   * ne veut pas qu'un facteur d'authentification soit prédictible, même
   * accompagné.
   *
   * LA SECONDE est la régularité du format. `Math.random().toString(36)`
   * rendait entre 1 et 6 caractères selon le tirage : un nombre un peu petit
   * donnait « CMD-2026-ABC », et réduisait d'autant l'espace des références.
   * Six caractères sont maintenant garantis, soit 36⁶ ≈ 2,2 milliards de
   * valeurs à chaque fois.
   *
   * `randomInt` plutôt qu'un reste de division sur `randomBytes` : 256 n'est
   * pas un multiple de 36, et le reste favoriserait les quatre premiers
   * caractères de l'alphabet. Le biais serait faible et sans conséquence
   * pratique — autant ne pas l'introduire.
   */
  static _genererReference() {
    const annee = new Date().getFullYear();
    let rand = '';
    for (let i = 0; i < 6; i += 1) {
      rand += ALPHABET_REFERENCE[crypto.randomInt(ALPHABET_REFERENCE.length)];
    }
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

  /**
   * Charge et verrouille (FOR UPDATE) un lot de produits en UNE requête.
   *
   * Avant : un `findByPk` verrouillé par article, dans l'ordre du panier.
   * Deux défauts :
   *   - N allers-retours vers la base pour un panier de N articles ;
   *   - un risque d'interblocage : la commande A verrouille P1 puis P2, la
   *     commande B (même produits, autre ordre) P2 puis P1, et PostgreSQL
   *     tue l'une des deux.
   * Trier par identifiant donne à toutes les transactions le même ordre de
   * verrouillage, ce qui supprime ce cas.
   *
   * @returns {Promise<Map<string, Produit>>} produits indexés par id
   */
  /**
   * Options choisies par le client pour une ligne (taille, parfum…) :
   * texte court uniquement, dix au plus. Rien de choisi = null.
   */
  static _options(options) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) return null;
    const propres = {};
    for (const [cle, valeur] of Object.entries(options).slice(0, 10)) {
      const k = String(cle).trim().slice(0, 40);
      const v = String(valeur ?? '').trim().slice(0, 80);
      if (k && v) propres[k] = v;
    }
    return Object.keys(propres).length ? propres : null;
  }

  static async _verrouillerProduits(ids, transaction) {
    const uniques = [...new Set(ids.filter(Boolean))];
    if (uniques.length === 0) return new Map();
    const produits = await Produit.findAll({
      where: { id: uniques },
      order: [['id', 'ASC']],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    return new Map(produits.map((p) => [p.id, p]));
  }

  // Décrémente le stock des produits d'une commande (dans une transaction)
  // `forcer` : la quantité ne descend pas sous zéro, sans refuser la commande
  // (commande saisie par le vendeur au-delà de son stock).
  static async _decrementerStock(commande, transaction, { forcer = false } = {}) {
    // GARDE INTERNE. Les trois appelants la posaient chacun de leur côté ;
    // un quatrième, distrait, sortait le stock une deuxième fois pour la
    // même commande. La fonction refuse maintenant d'elle-même.
    if (commande.stockDecremente) return;

    const lignes = await LigneCommande.findAll({
      where: { commandeId: commande.id },
      transaction,
    });

    // Verrou pessimiste pour éviter la survente en cas de commandes simultanées
    const produits = await CommandeService._verrouillerProduits(
      lignes.map((l) => l.produitId),
      transaction,
    );

    // Produits qui tombent à zéro pendant cette vente : le vendeur doit
    // l'apprendre, et il faut attendre le commit pour le lui dire.
    const epuises = [];

    for (const ligne of lignes) {
      if (!ligne.produitId) continue;
      const produit = produits.get(ligne.produitId);
      if (!produit) continue;

      if (!forcer && produit.quantite < ligne.quantite) {
        throw new BadRequestError(`Stock insuffisant pour "${produit.nom}" (reste ${produit.quantite}).`);
      }

      produit.quantite = Math.max(0, produit.quantite - ligne.quantite);
      // Une commande du vendeur ne met pas son produit hors ligne : c'est lui
      // qui décide de l'interrupteur « En ligne ».
      if (produit.quantite === 0 && !forcer) {
        produit.disponible = false;
        epuises.push(produit.nom);
      }
      await produit.save({ transaction });
    }

    commande.stockDecremente = true;
    await commande.save({ transaction });

    // LE PRODUIT PASSE HORS LIGNE EN SILENCE, et c'est ce silence qui coûte :
    // le vendeur croirait vendre encore, alors que sa fiche
    // n'est plus proposée à personne. Après le commit — un stock décrémenté
    // puis annulé ne doit pas laisser une fausse alerte derrière lui.
    if (epuises.length && transaction) {
      transaction.afterCommit(() =>
        CommandeService._prevenirStockEpuise(commande.vendeurId, epuises).catch(echecIgnore('alerte stock épuisé'))
      );
    }
  }

  /** « Robe wax est en rupture » : le vendeur remet du stock, ou pas. */
  static async _prevenirStockEpuise(vendeurId, noms) {
    if (!vendeurId || !noms.length) return;
    const liste = noms.slice(0, 3).join(', ');
    const reste = noms.length - 3;

    await NotificationService.creerNotification({
      utilisateurId: vendeurId,
      titre: noms.length > 1 ? 'Produits en rupture' : 'Produit en rupture',
      message: `${liste}${reste > 0 ? ` et ${reste} autre${reste > 1 ? 's' : ''}` : ''} : `
        + `plus de stock. ${noms.length > 1 ? 'Ils ne sont plus proposés' : 'Il n\'est plus proposé'}`
        + ' aux clients tant que vous n\'en remettez pas.',
      type: 'systeme',
      data: { ecran: 'mes_produits', pourVendeur: true },
    });
  }

  // Restaure le stock (annulation / remboursement)
  static async _restaurerStock(commande, transaction) {
    if (!commande.stockDecremente) return;

    const lignes = await LigneCommande.findAll({
      where: { commandeId: commande.id },
      transaction,
    });

    const produits = await CommandeService._verrouillerProduits(
      lignes.map((l) => l.produitId),
      transaction,
    );

    for (const ligne of lignes) {
      if (!ligne.produitId) continue;
      const produit = produits.get(ligne.produitId);
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
    if (numeroTelephone) {
      const erreur = erreurTelephone(numeroTelephone);
      if (erreur) throw new BadRequestError(erreur);
      numeroTelephone = normaliserTelephone(numeroTelephone);
    }

    const t = await sequelize.transaction();
    try {
      // 1) Charger et valider tous les produits
      const lignesData = [];
      let vendeurId = null;
      let montantProduits = 0;

      // Validation de forme d'abord : inutile de verrouiller des lignes en
      // base pour un panier qu'on va refuser de toute façon.
      for (const item of items) {
        const quantite = parseInt(item?.quantite, 10);
        if (!item?.produitId || !quantite || quantite < 1) {
          throw new BadRequestError('Chaque article doit avoir un produitId et une quantité valide.');
        }
      }

      const produits = await CommandeService._verrouillerProduits(
        items.map((i) => i.produitId),
        t,
      );

      // Quantité déjà demandée par produit dans CE panier. Sans ce cumul, un
      // même produit présent sur deux lignes (2 + 2 pour un stock de 3)
      // passait le contrôle ligne par ligne et le stock devenait négatif.
      const dejaDemande = new Map();

      for (const item of items) {
        const quantite = parseInt(item.quantite, 10);

        const produit = produits.get(item.produitId);
        if (!produit) throw new BadRequestError(`Produit introuvable : ${item.produitId}`);
        // Commande saisie par le vendeur lui-même : il peut y mettre un
        // produit hors ligne ou en rupture de stock — il sait ce qu'il a.
        const saisieVendeur = origine === 'dashboard';
        if (!saisieVendeur && !produit.disponible) throw new BadRequestError(`Le produit "${produit.nom}" n'est pas disponible.`);
        const cumul = (dejaDemande.get(produit.id) || 0) + quantite;
        if (!saisieVendeur && produit.quantite < cumul) {
          throw new BadRequestError(`Stock insuffisant pour "${produit.nom}" (reste ${produit.quantite}).`);
        }
        dejaDemande.set(produit.id, cumul);

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
          options: CommandeService._options(item.options),
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

      // 3) Statut initial : le vendeur décide d'abord, et le stock n'est réservé
      //    qu'à son acceptation. Seule une commande saisie par l'administration
      //    et réglée à la livraison est engagée d'emblée.
      //    Une commande saisie par le vendeur lui-même l'est aussi : il l'a
      //    déjà acceptée en la prenant.
      const engageeDEmblee = ['admin', 'dashboard'].includes(origine) && modePaiement !== 'en_ligne';

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
        statut: engageeDEmblee ? 'confirmee' : 'en_attente',
        statutPaiement: 'non_paye',
        modeLivraison,
        modePaiement,
        adresseLivraison,
        numeroTelephone,
        note,
        origine,
      }, { transaction: t });

      // 4) Créer les lignes
      // Un seul INSERT pour toutes les lignes (le modèle n'a pas de hook).
      await LigneCommande.bulkCreate(
        lignesData.map((l) => ({ ...l, commandeId: commande.id })),
        { transaction: t, validate: true },
      );

      // 5) Réserver le stock d'une commande engagée d'emblée
      if (engageeDEmblee) {
        // Saisie du vendeur : le stock descend jusqu'à zéro sans bloquer.
        await CommandeService._decrementerStock(commande, t, { forcer: origine === 'dashboard' });
      }

      await t.commit();

      // 6) Notifier le vendeur (hors transaction)
      // (inutile quand c'est lui qui vient de la saisir).
      if (origine !== 'dashboard') {
        CommandeService._notifierVendeurNouvelleCommande(commande).catch(echecIgnore('notification nouvelle commande au vendeur'));
      }
      CommandeService._historiser({
        commandeId: commande.id,
        auteurId: commande.acheteurId,
        auteurRole: origine === 'dashboard' ? 'vendeur' : 'acheteur',
        operation: 'creation',
        statutApres: commande.statut,
        paiementApres: commande.statutPaiement,
        details: { origine, montantTotal: commande.montantTotal },
      });
      // Le client reçoit un accusé de réception au nom de la boutique.
      CommandeService._emailClient(commande, 'recue').catch(echecIgnore('e-mail accusé de réception au client'));

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

      // Un paiement arrivé après une annulation reste enregistré (à rembourser),
      // mais ne ressuscite pas la commande et ne réserve aucun stock.
      const abandonnee = ['annulee', 'rejetee'].includes(commande.statut);

      commande.statutPaiement = 'paye';
      if (['en_attente', 'acceptee'].includes(commande.statut)) commande.statut = 'payee';
      await commande.save({ transaction: t });

      // Décrémenter le stock maintenant (si pas déjà fait)
      if (!abandonnee && !commande.stockDecremente) {
        await CommandeService._decrementerStock(commande, t);
      }

      // APRÈS LE COMMIT, ET SEULEMENT S'IL A LIEU.
      //
      // Le webhook de paiement appelle cette méthode avec SA transaction, qu'il
      // valide lui-même après coup. Exécutées dans cette transaction encore
      // ouverte, les lignes qui suivent préviendraient le client et le vendeur
      // d'un encaissement que la base n'enregistrerait pas si le commit
      // échouait ensuite ; et l'e-mail, qui relit la commande hors
      // transaction, y lirait encore l'ancien statut.
      //
      // `afterCommit` ne se déclenche jamais sur un rollback, et vaut pour les
      // deux cas — transaction à nous, ou transaction de l'appelant.
      t.afterCommit(() => {
        CommandeService._historiser({
          commandeId: commande.id,
          auteurRole: 'systeme',
          operation: 'paiement',
          statutApres: commande.statut,
          paiementAvant: 'non_paye',
          paiementApres: 'paye',
          details: { source: 'passerelle' },
        });
        CommandeService._diffuserStatut(commande);
        CommandeService._notifierVendeurNouvelleCommande(commande, true).catch(echecIgnore('notification commande payée au vendeur'));
        CommandeService._notifierAcheteurStatut(commande).catch(echecIgnore('notification de statut à l\'acheteur'));
      });

      if (gererTransaction) await t.commit();
      return commande;

    } catch (err) {
      if (gererTransaction) await t.rollback();
      throw err;
    }
  }

  // -------------------- LISTES --------------------

  /**
   * Les commandes d'un acheteur.
   *
   * PAGINEE, dix par page. L'application affiche « Precedent / Suivant » :
   * rien n'est perdu, tout se parcourt.
   *
   * Sans limite, un client qui commande chaque semaine depuis deux ans
   * telechargerait cent commandes, leurs lignes et leurs vendeurs a chaque
   * ouverture de l'onglet — et l'onglet se recharge au retour, sur
   * evenement, et toutes les 30 secondes.
   */
  static async mesCommandes(acheteurId, { statut, page, limit } = {}) {
    const where = { acheteurId };
    if (statut) where.statut = statut;
    const requete = {
      where,
      include: [
        { model: LigneCommande, as: 'lignes' },
        inclureVendeur(),
      ],
      order: [['createdAt', 'DESC']],
    };

    const { page: p, limit: l, offset } = paginate(page, limit);
    const { rows, count } = await Commande.findAndCountAll({
      ...requete,
      limit: l,
      offset,
      // Sans `distinct`, les lignes jointes gonflent le compte total.
      distinct: true,
    });
    return { commandes: rows, ...metaPagination(count, p, l) };
  }

  /** Les commandes recues par un vendeur. Paginee comme `mesCommandes`. */
  static async commandesVendeur(vendeurId, { statut, origine, page, limit } = {}) {
    const where = { vendeurId };
    if (statut) where.statut = statut;
    // 'application' | 'vitrine' | 'dashboard' — le vendeur veut pouvoir
    // regarder ce que son site lui apporte, séparément du reste.
    if (origine) where.origine = origine;
    const requete = {
      where,
      include: [
        { model: LigneCommande, as: 'lignes' },
        // `required: false` : une commande venue du site d'une boutique n'a
        // pas d'acheteur. Sans cela, Sequelize passerait en jointure interne
        // et ces commandes disparaîtraient de la liste du vendeur.
        { model: Utilisateur, as: 'acheteur', attributes: ['id', 'nom', 'prenom', 'telephone'], required: false },
      ],
      order: [['createdAt', 'DESC']],
    };

    const { page: p, limit: l, offset } = paginate(page, limit);
    const { rows, count } = await Commande.findAndCountAll({
      ...requete,
      limit: l,
      offset,
      distinct: true,
    });
    return {
      commandes: rows.map(CommandeService.avecClient),
      ...metaPagination(count, p, l),
    };
  }

  /**
   * Annonce aux DEUX parties que cette commande a changé d'état.
   *
   * Les notifications existantes ne préviennent que l'acheteur, et seulement
   * pour lui afficher un message, sans dire aux écrans de commandes de se
   * relire. Sans cette diffusion, le tableau de bord du vendeur et la fiche
   * de l'acheteur pourraient montrer deux statuts differents pour la meme
   * commande, chacun figé sur ce qu'il a lu en arrivant.
   *
   * La charge est volontairement minuscule : l'identifiant et les deux
   * statuts. Le client relit la commande s'il en a besoin — on ne diffuse ni
   * les lignes, ni le client, ni les montants sur un canal temps réel.
   *
   * Silencieux par construction : une diffusion ratée ne doit jamais faire
   * échouer la transaction qui vient d'aboutir.
   */
  /**
   * Consigne une opération dans l'historique de la commande.
   *
   * SANS JAMAIS FAIRE ÉCHOUER L'OPÉRATION RÉELLE : l'écriture suit une
   * transaction déjà validée, et une commande acceptée ne doit pas se
   * dé-accepter parce que le journal est indisponible. L'échec est tracé
   * dans les logs applicatifs, pas remonté à l'appelant.
   *
   * Aucune route ne modifie ni ne supprime ces lignes : le modèle n'a pas
   * d'`updatedAt`, et rien n'expose d'écriture.
   */
  static _historiser({
    commandeId,
    auteurId = null,
    auteurRole = 'systeme',
    operation,
    statutAvant = null,
    statutApres = null,
    paiementAvant = null,
    paiementApres = null,
    motif = null,
    details = null,
  }) {
    HistoriqueCommande.create({
      commandeId,
      auteurId,
      auteurRole,
      operation,
      statutAvant,
      statutApres,
      paiementAvant,
      paiementApres,
      motif,
      details,
    }).catch((err) =>
      logger.error('[commande] historique non enregistré', {
        message: err.message,
        commandeId,
        operation,
      })
    );
  }

  static _diffuserStatut(commande) {
    try {
      const charge = {
        id: commande.id,
        statut: commande.statut,
        statutPaiement: commande.statutPaiement,
      };
      const io = getIO();
      for (const destinataire of [commande.acheteurId, commande.vendeurId]) {
        if (destinataire) io.to('user:' + destinataire).emit('commande:statut', charge);
      }
    } catch (_) {
      /* Socket.IO pas encore initialisé, ou aucun client connecté. */
    }
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
        inclureVendeur(),
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

  /**
   * La transition `de → vers` est-elle prévue par le workflow ?
   *
   * Exposée pour que l'administration lise LA MÊME TABLE que le vendeur.
   * Elle s'en passait : `modifierCommande` acceptait n'importe quel statut
   * depuis n'importe quel autre, et pouvait faire passer une commande de
   * « en attente » à « livrée » sans qu'elle ait jamais été préparée.
   */
  static transitionPermise(de, vers) {
    if (de === vers) return true; // rien à faire, pas une erreur
    return (TRANSITIONS[de] || []).includes(vers);
  }

  /** Les statuts atteignables depuis celui-ci, pour un message utile. */
  static transitionsDepuis(de) {
    return [...(TRANSITIONS[de] || [])];
  }

  /** Libellé français d'un statut, pour les messages destinés aux humains. */
  static libelleStatut(statut) {
    return libelle(statut);
  }

  // -------------------- CHANGER LE STATUT (vendeur) --------------------
  static async changerStatut(commandeId, vendeurId, nouveauStatut) {
    // Lu sous verrou : deux appels simultanés sur la même commande se
    // suivaient sinon sans se voir, et la seconde transition partait d'un
    // statut déjà périmé.
    const commande = await sequelize.transaction(async (t) =>
      Commande.findByPk(commandeId, { transaction: t, lock: t.LOCK.UPDATE })
    );
    if (!commande) throw new NotFoundError('Commande introuvable');
    if (commande.vendeurId !== vendeurId) {
      throw new ForbiddenError('Cette commande ne vous appartient pas');
    }

    // POINT 9 : une commande À LIVRER passe par « en livraison ».
    // `prete → livree` existe pour le RETRAIT EN BOUTIQUE, où il n'y a pas
    // d'expédition. Ouvert à tous, il laisserait marquer livrée une commande
    // dont personne n'a enregistré le départ.
    if (
      commande.statut === 'prete' &&
      nouveauStatut === 'livree' &&
      commande.modeLivraison !== 'retrait'
    ) {
      throw new BadRequestError(
        'Cette commande est à livrer : marquez-la « en livraison » avant de la déclarer livrée.'
      );
    }

    // LA DEMANDE EST DÉJÀ SATISFAITE.
    //
    // Deuxième appui sur « Accepter » parce que le premier n'avait pas encore
    // répondu, réessai après une coupure réseau, deux appareils du même
    // vendeur : la commande est déjà dans l'état demandé. Il n'y a rien à
    // faire, et surtout rien à reprocher. On rend la commande telle quelle.
    //
    // Une erreur bloquerait le vendeur devant une commande qu'il vient
    // d'accepter, sur un écran qui affiche encore « en attente ».
    if (commande.statut === nouveauStatut) return commande;

    const autorises = TRANSITIONS[commande.statut] || [];
    if (!autorises.includes(nouveauStatut)) {
      throw new BadRequestError(
        `Cette commande est « ${libelle(commande.statut)} » : elle ne peut pas passer à « ${libelle(nouveauStatut)} ».`
      );
    }

    if (nouveauStatut === 'annulee') {
      return await CommandeService._annuler(commande, 'vendeur');
    }
    if (nouveauStatut === 'rejetee') {
      return await CommandeService._annuler(commande, 'vendeur', 'rejetee');
    }
    if (nouveauStatut === 'acceptee') {
      return await CommandeService._accepter(commande.id);
    }
    // Une commande à régler en ligne attend son paiement avant d'être préparée.
    if (commande.statut === 'acceptee' && commande.modePaiement === 'en_ligne' && commande.acheteurId) {
      throw new BadRequestError('Le client n\'a pas encore payé cette commande.');
    }

    const statutAvant = commande.statut;
    commande.statut = nouveauStatut;
    await commande.save();

    CommandeService._historiser({
      commandeId: commande.id,
      auteurId: vendeurId,
      auteurRole: 'vendeur',
      operation: 'statut',
      statutAvant,
      statutApres: nouveauStatut,
    });

    // À la livraison : incrémenter le compteur de ventes des produits (tri "meilleures ventes")
    if (nouveauStatut === 'livree') {
      CommandeService._incrementerVentes(commande.id).catch(echecIgnore('compteur de ventes'));
    }

    CommandeService._diffuserStatut(commande);
    // Notifier l'acheteur de l'avancement
    CommandeService._notifierAcheteurStatut(commande).catch(echecIgnore('notification de statut à l\'acheteur'));
    return commande;
  }

  // -------------------- VENDEUR : confirmer un paiement reçu en main propre --------------------
  // Pour une commande réglée à la livraison (ou au retrait) : le vendeur
  // confirme qu'il a bien été payé, et la commande entre dans sa comptabilité.
  // Les paiements en ligne, eux, sont confirmés par la passerelle.
  static async confirmerPaiementVendeur(commandeId, vendeurId) {
    const commande = await Commande.findByPk(commandeId);
    if (!commande) throw new NotFoundError('Commande introuvable');
    if (commande.vendeurId !== vendeurId) {
      throw new ForbiddenError('Cette commande ne vous appartient pas');
    }
    // TANT QUE LE PAIEMENT EN LIGNE N'EST PAS OUVERT, toute commande se règle
    // hors de l'application — y compris celles créées en « en ligne » avant
    // cette bascule. Le vendeur doit donc pouvoir confirmer qu'il a été payé.
    //
    // Sans cette condition, une commande marquée « en ligne » et réglée de la
    // main à la main restait « non payée » POUR TOUJOURS : le serveur
    // refusait la confirmation en expliquant que le paiement se ferait tout
    // seul, ce qui n'arrivait jamais puisque Wave et Orange Money ne sont pas
    // branchés.
    if (paiementEnLigneActif && commande.modePaiement === 'en_ligne') {
      throw new BadRequestError('Cette commande se règle en ligne : son paiement est confirmé automatiquement.');
    }
    if (['annulee', 'rejetee'].includes(commande.statut)) {
      throw new BadRequestError('Cette commande est annulée.');
    }
    if (commande.statut === 'en_attente') {
      throw new BadRequestError('Acceptez d\'abord la commande.');
    }
    // Relecture sous verrou : deux confirmations simultanées ne doivent
    // enregistrer qu'un seul encaissement.
    return await sequelize.transaction(async (t) => {
      const verrouillee = await Commande.findByPk(commandeId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      // Déjà confirmé : rien à refaire.
      if (verrouillee.statutPaiement === 'paye') return verrouillee;

      verrouillee.statutPaiement = 'paye';
      await verrouillee.save({ transaction: t });
      CommandeService._historiser({
        commandeId: verrouillee.id,
        auteurId: vendeurId,
        auteurRole: 'vendeur',
        operation: 'paiement',
        statutApres: verrouillee.statut,
        paiementAvant: 'non_paye',
        paiementApres: 'paye',
        details: { source: 'main_propre' },
      });
      CommandeService._diffuserStatut(verrouillee);
      return verrouillee;
    });
  }

  /** Le stock est réservé ici : c'est l'engagement du vendeur à livrer. */
  static async _accepter(commandeId) {
    const t = await sequelize.transaction();
    try {
      const commande = await Commande.findByPk(commandeId, { transaction: t, lock: t.LOCK.UPDATE });
      if (commande.statut !== 'en_attente') {
        throw new BadRequestError('Cette commande a déjà été traitée.');
      }
      if (!commande.stockDecremente) {
        await CommandeService._decrementerStock(commande, t);
      }
      commande.statut = 'acceptee';
      await commande.save({ transaction: t });
      await t.commit();

      CommandeService._historiser({
        commandeId: commande.id,
        auteurId: commande.vendeurId,
        auteurRole: 'vendeur',
        operation: 'statut',
        statutAvant: 'en_attente',
        statutApres: 'acceptee',
      });

      CommandeService._diffuserStatut(commande);
      CommandeService._notifierAcheteurStatut(commande, CommandeService._messageAcceptation(commande)).catch(echecIgnore('notification d\'acceptation à l\'acheteur'));
      return commande;
    } catch (err) {
      await t.rollback();
      throw err;
    }
  }

  static _messageAcceptation(commande) {
    // Tant que le paiement en ligne est fermé, toute commande se règle avec
    // la boutique — y compris celles créées en « en ligne » avant la
    // bascule. Les renvoyer vers un écran de paiement qui n'aboutit pas
    // serait leur faire perdre leur temps.
    if (!paiementEnLigneActif || commande.modePaiement !== 'en_ligne') {
      return 'Votre commande est acceptée. Vous la réglerez directement avec la boutique.';
    }
    return commande.acheteurId
      ? 'Votre commande est acceptée. Ouvrez « Mes commandes » dans l\'application pour la payer par Wave ou Orange Money.'
      : 'Votre commande est acceptée. La boutique vous contactera pour le règlement.';
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
  static async annulerCommande(commandeId, acheteurId, motif = null) {
    const commande = await Commande.findByPk(commandeId);
    if (!commande) throw new NotFoundError('Commande introuvable');
    if (commande.acheteurId !== acheteurId) {
      throw new ForbiddenError('Cette commande ne vous appartient pas');
    }
    if (commande.statutPaiement === 'paye') {
      throw new BadRequestError(
        'Cette commande est payée : elle ne peut plus être annulée. Demandez un retour une fois livrée.'
      );
    }
    // En préparation, le vendeur a déjà engagé du travail : l'acheteur
    // demande, il ne décide plus seul. Voir `demanderAnnulation`.
    if (commande.statut === 'en_preparation') {
      throw new BadRequestError(
        'Cette commande est déjà en préparation : demandez son annulation au vendeur.'
      );
    }
    if (!['en_attente', 'acceptee', 'payee', 'confirmee'].includes(commande.statut)) {
      throw new BadRequestError('Cette commande ne peut plus être annulée.');
    }
    return await CommandeService._annuler(commande, 'acheteur', 'annulee', {
      auteurId: acheteurId,
      motif,
    });
  }

  // -------------------- ACHETEUR : DEMANDER une annulation --------------------

  /**
   * Commande déjà en préparation : l'acheteur demande, le vendeur tranche.
   *
   * Aucun statut n'est créé pour cela. La commande reste « en préparation »
   * — le vendeur peut donc continuer, ou la faire avancer, tant qu'il n'a
   * pas répondu. Seule `annulationDemandeeLe` dit qu'une demande attend.
   */
  static async demanderAnnulation(commandeId, acheteurId, motif) {
    const raison = String(motif || '').trim();
    if (!raison) throw new BadRequestError('Indiquez la raison de votre demande.');

    const commande = await Commande.findByPk(commandeId);
    if (!commande) throw new NotFoundError('Commande introuvable');
    if (commande.acheteurId !== acheteurId) {
      throw new ForbiddenError('Cette commande ne vous appartient pas');
    }
    if (commande.statut !== 'en_preparation') {
      throw new BadRequestError(
        'Une demande d\'annulation ne se fait que sur une commande en préparation.'
      );
    }
    if (commande.annulationDemandeeLe) {
      throw new BadRequestError('Une demande est déjà en attente de réponse.');
    }

    commande.annulationDemandeeLe = new Date();
    commande.annulationMotif = raison.slice(0, 500);
    commande.annulationRefusMotif = null;
    await commande.save();

    CommandeService._historiser({
      commandeId: commande.id,
      auteurId: acheteurId,
      auteurRole: 'acheteur',
      operation: 'demande_annulation',
      statutApres: commande.statut,
      motif: commande.annulationMotif,
    });
    CommandeService._diffuserStatut(commande);
    CommandeService._nomAcheteur(commande.acheteurId).then((nom) =>
      CommandeService._notifierUtilisateur(
        commande.vendeurId,
        'Demande d\'annulation',
        `${nom || 'Un client'} demande l'annulation de la commande ${commande.referenceCommande}.`,
        { data: CommandeService._donneesNotification(commande, commande.acheteurId, nom, { pourVendeur: true }) },
      )
    ).catch(echecIgnore('notification demande d\'annulation au vendeur'));

    return commande;
  }

  // -------------------- VENDEUR : RÉPONDRE à une demande d'annulation --------

  /** Le vendeur accepte (la commande est annulée) ou refuse, avec un motif. */
  static async repondreDemandeAnnulation(commandeId, vendeurId, { accepte, motif }) {
    const commande = await Commande.findByPk(commandeId);
    if (!commande) throw new NotFoundError('Commande introuvable');
    if (commande.vendeurId !== vendeurId) {
      throw new ForbiddenError('Cette commande ne vous appartient pas');
    }
    if (!commande.annulationDemandeeLe) {
      throw new BadRequestError('Aucune demande d\'annulation en attente sur cette commande.');
    }

    if (accepte) {
      return await CommandeService._annuler(commande, 'vendeur', 'annulee', {
        auteurId: vendeurId,
        motif: commande.annulationMotif,
      });
    }

    // Refus : la demande se referme, la commande poursuit son cours, et le
    // motif reste lisible par l'acheteur.
    commande.annulationDemandeeLe = null;
    commande.annulationRefusMotif = String(motif || '').trim().slice(0, 500) || null;
    await commande.save();

    CommandeService._historiser({
      commandeId: commande.id,
      auteurId: vendeurId,
      auteurRole: 'vendeur',
      operation: 'reponse_annulation',
      statutApres: commande.statut,
      motif: commande.annulationRefusMotif,
      details: { accepte: false },
    });
    CommandeService._diffuserStatut(commande);
    CommandeService._notifierAcheteurStatut(
      commande,
      commande.annulationRefusMotif
        ? `Votre demande d'annulation a été refusée : ${commande.annulationRefusMotif}`
        : 'Votre demande d\'annulation a été refusée. La commande suit son cours.',
    ).catch(echecIgnore('notification refus d\'annulation à l\'acheteur'));

    return commande;
  }

  /**
   * Annule (ou rejette) une commande. SEUL POINT DE PASSAGE : acheteur,
   * vendeur et administration y aboutissent tous.
   *
   * UNE COMMANDE PAYÉE NE S'ANNULE PAS. Elle se traite par la procédure de
   * retour, qui, elle, trace un remboursement : la basculer en « remboursé »
   * sans déclencher le remboursement réel laisserait le client débité
   * pendant que la comptabilité dirait l'inverse.
   *
   * La commande est RELUE ET VERROUILLÉE dans la transaction. Sans ce
   * verrou, deux annulations simultanées liraient toutes deux
   * `stockDecremente = true` et restaureraient toutes deux les quantités : le
   * stock gonflerait d'autant.
   */
  static async _annuler(commandeRecue, parQui, statutFinal = 'annulee', { auteurId = null, motif = null } = {}) {
    const t = await sequelize.transaction();
    try {
      const commande = await Commande.findByPk(commandeRecue.id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!commande) throw new NotFoundError('Commande introuvable');

      // Déjà dans l'état visé : la deuxième requête d'une paire simultanée.
      // Rien à refaire, et surtout pas un second retour de stock.
      if (['annulee', 'rejetee'].includes(commande.statut)) {
        await t.rollback();
        return commande;
      }

      if (commande.statutPaiement === 'paye') {
        throw new BadRequestError(
          'Cette commande est payée : elle ne peut plus être annulée. Passez par une demande de retour.'
        );
      }

      // Restaurer le stock si réservé
      await CommandeService._restaurerStock(commande, t);

      const statutAvant = commande.statut;
      commande.statut = statutFinal;
      // Une demande d'annulation en cours n'a plus d'objet.
      commande.annulationDemandeeLe = null;
      // Le motif de l'annulation, quand il y en a un, reste attaché à la
      // commande — et pas seulement au journal.
      if (motif) commande.annulationMotif = String(motif).trim().slice(0, 500);
      await commande.save({ transaction: t });

      await t.commit();

      CommandeService._historiser({
        commandeId: commande.id,
        auteurId,
        auteurRole: parQui,
        operation: statutFinal === 'rejetee' ? 'rejet' : 'annulation',
        statutAvant,
        statutApres: statutFinal,
        motif: commande.annulationMotif,
      });

      CommandeService._diffuserStatut(commande);

      // Notifier l'autre partie
      if (statutFinal === 'rejetee') {
        CommandeService._notifierAcheteurStatut(commande).catch(echecIgnore('notification de statut à l\'acheteur'));
      } else if (parQui === 'vendeur') {
        CommandeService._notifierAcheteurStatut(commande, 'Votre commande a été annulée par le vendeur.').catch(echecIgnore('notification annulation par le vendeur'));
      } else {
        CommandeService._nomAcheteur(commande.acheteurId).then(nom => CommandeService._notifierUtilisateur(
          commande.vendeurId,
          'Commande annulée',
          `La commande ${commande.referenceCommande} a été annulée par l'acheteur.`,
          { data: CommandeService._donneesNotification(commande, commande.acheteurId, nom, { pourVendeur: true }) },
        )).catch(echecIgnore('notification annulation par l\'acheteur'));
      }
      return commande;
    } catch (err) {
      await t.rollback();
      throw err;
    }
  }

  // -------------------- NOTIFICATIONS --------------------

  /**
   * Notification dans l'application + push. `image` : logo de la boutique
   * quand la notification parle au client d'une boutique. (Le push part
   * depuis NotificationService : un second envoi ici doublait chaque push.)
   */
  static async _notifierUtilisateur(utilisateurId, titre, message, { image, data = {} } = {}) {
    await NotificationService.creerNotification({
      utilisateurId, titre, message, type: 'commande', image, data,
    });
  }

  /** Ce qu'il faut pour ouvrir, depuis la notification, la conversation liée. */
  static _donneesNotification(commande, interlocuteurId, interlocuteurNom, { pourVendeur }) {
    return {
      commandeId: commande.id,
      // La référence et le statut voyagent avec la notification : le
      // téléphone n'a pas à interroger le serveur pour savoir de quelle
      // commande on lui parle. Quand la lecture de la commande échoue à
      // l'ouverture — réseau coupé au réveil —, c'est ce qui permet encore
      // de dire « commande CMD-2026-… » plutôt que rien.
      reference: commande.referenceCommande || '',
      statut: commande.statut || '',
      // De quel cote est celui qui lit. La fiche d'une commande n'affiche pas
      // les memes boutons a l'acheteur et au vendeur : sans cette indication,
      // une notification touchee DEPUIS LE TELEPHONE, hors de l'application,
      // ne peut pas ouvrir la bonne version de l'ecran — rien d'autre, dans
      // la charge du push, ne dit qui est destinataire.
      pourVendeur,
      ...(interlocuteurId ? { interlocuteurId, interlocuteurNom: interlocuteurNom || '' } : {}),
    };
  }

  /** Identité de la boutique d'un vendeur, pour les messages au client. */
  static async _boutiqueDuVendeur(vendeurId) {
    const b = await Boutique.findOne({
      where: { vendeurId },
      attributes: ['nom', 'logo', 'telephone', 'whatsapp', 'vitrineAccent'],
    });
    return b
      ? { nom: b.nom, logo: b.logo, telephone: b.whatsapp || b.telephone, couleur: b.vitrineAccent }
      : { nom: 'Votre boutique', logo: null, telephone: null };
  }

  /**
   * Email au client, au logo et au nom de la boutique. Compte acheteur ou
   * client sans compte (commande passée sur le site de la boutique) : on
   * écrit à l'adresse connue, s'il y en a une.
   */
  static async _emailClient(commande, etape, messagePerso = null) {
    const complete = await Commande.findByPk(commande.id, {
      include: [
        { model: LigneCommande, as: 'lignes', attributes: ['nomProduit', 'quantite', 'sousTotal'] },
        { model: Utilisateur, as: 'acheteur', attributes: ['email', 'prenom', 'nom'] },
      ],
    });
    if (!complete) return;
    const to = complete.acheteur?.email || complete.clientEmail;
    if (!to) return;
    const boutique = await CommandeService._boutiqueDuVendeur(complete.vendeurId);
    await sendCommandeClientEmail({
      to,
      etape,
      boutique,
      nomClient: complete.acheteur?.prenom || complete.clientPrenom || '',
      commande: complete,
      lignes: complete.lignes || [],
      messagePerso,
    });
  }

  /**
   * Le vendeur est prévenu qu'une commande arrive, puis qu'elle est payée.
   *
   * L'e-mail ne part QU'À L'ARRIVÉE de la commande : le même gabarit
   * « Nouvelle commande », renvoyé à l'encaissement, ferait recevoir au
   * vendeur deux fois le même e-mail pour une seule vente payée en ligne.
   * L'encaissement, lui, reste annoncé par une notification — c'est un
   * changement de statut, et ceux-là ne passent pas par l'e-mail.
   */
  static async _notifierVendeurNouvelleCommande(commande, paiementConfirme = false) {
    const titre = paiementConfirme ? '💰 Commande payée' : '🛒 Nouvelle commande';
    const message = `Commande ${commande.referenceCommande} — ${montantLisible(commande.montantTotal)}.`;
    const nomAcheteur = await CommandeService._nomAcheteur(commande.acheteurId);
    await CommandeService._notifierUtilisateur(commande.vendeurId, titre, message, {
      data: CommandeService._donneesNotification(commande, commande.acheteurId, nomAcheteur, { pourVendeur: true }),
    });
    if (paiementConfirme) return;
    Utilisateur.findByPk(commande.vendeurId).then(vendeur => vendeur && sendNouvelleCommandeEmail({ to: vendeur.email, nom: `${vendeur.prenom || ''} ${vendeur.nom || ''}`.trim(), referenceCommande: commande.referenceCommande, montantTotal: commande.montantTotal })).catch(echecIgnore('e-mail nouvelle commande au vendeur'));
  }

  /**
   * Le client est prévenu de chaque étape au nom de la boutique.
   *
   * UN CHANGEMENT DE STATUT N'ENVOIE PLUS D'E-MAIL — il envoie une
   * notification, dans l'application et sur le téléphone. Une commande passée
   * le matin et livrée l'après-midi produisait six e-mails ; le même parcours
   * tient maintenant en six notifications, que le client retrouve dans son
   * centre de notifications.
   *
   * SEULE EXCEPTION, ET ELLE EST NÉCESSAIRE : la commande passée SANS COMPTE,
   * depuis le site de la boutique. Ce client n'a pas l'application, donc aucun
   * appareil enregistré : aucune notification ne peut l'atteindre, et lui
   * retirer l'e-mail le laisserait sans nouvelle de sa commande.
   */
  static async _notifierAcheteurStatut(commande, messagePerso = null) {
    const libelles = {
      acceptee: 'Votre commande est acceptée.',
      rejetee: 'Votre commande a été rejetée par la boutique. Vous ne serez pas débité.',
      payee: 'Votre paiement est bien reçu. Merci !',
      confirmee: 'Votre commande est confirmée.',
      en_preparation: 'Votre commande est en préparation.',
      prete: 'Votre commande est prête.',
      en_livraison: 'Votre commande est en cours de livraison.',
      livree: 'Votre commande a été livrée. Merci pour votre achat !',
      annulee: 'Votre commande a été annulée.',
    };
    const message = messagePerso || libelles[commande.statut] || `Statut : ${commande.statut}`;

    // Commande passée sans compte : pas d'appareil à joindre, donc l'e-mail
    // reste son seul canal. Avec un compte, c'est la notification qui porte
    // la nouvelle — jamais les deux, pour ne pas prévenir deux fois.
    if (!commande.acheteurId) {
      CommandeService._emailClient(commande, commande.statut, messagePerso).catch(echecIgnore('e-mail de suivi au client'));
      return;
    }

    const boutique = await CommandeService._boutiqueDuVendeur(commande.vendeurId);
    await CommandeService._notifierUtilisateur(
      commande.acheteurId,
      `${boutique.nom} — Commande ${commande.referenceCommande}`,
      message,
      { image: boutique.logo, data: CommandeService._donneesNotification(commande, commande.vendeurId, boutique.nom, { pourVendeur: false }) },
    );
  }

  /** Nom affiché d'un acheteur (titre de la conversation côté vendeur). */
  static async _nomAcheteur(acheteurId) {
    if (!acheteurId) return '';
    const a = await Utilisateur.findByPk(acheteurId, { attributes: ['prenom', 'nom'] });
    return a ? `${a.prenom || ''} ${a.nom || ''}`.trim() : '';
  }
}

module.exports = CommandeService;
