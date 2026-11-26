const crypto = require('crypto');
const { Op } = require('sequelize');
const { LienSuivi, Commande, LigneCommande, Boutique } = require('../../models');
const { NotFoundError, BadRequestError } = require('../../errors/AppError');
const { estEmailValide } = require('../../utils/email');

/**
 * Les liens de suivi des commandes passées sans compte.
 *
 * Un client du site d'une boutique n'a pas de compte : son seul moyen de
 * revenir voir sa commande est le lien qu'on lui envoie. Ce service le
 * fabrique, le vérifie et le renouvelle.
 *
 * Ce qui tient sa sûreté, et pourquoi :
 *
 * - **256 bits tirés au hasard.** `crypto.randomBytes(32)`, rendu en
 *   base64url : 43 caractères sans caractère à échapper dans une URL. Un
 *   jeton ne se devine pas, ne s'énumère pas, et ne se déduit d'aucune
 *   donnée de la commande — contrairement à une référence courte, qui
 *   s'essaie.
 * - **Rien de chiffré, donc rien à déchiffrer.** Le jeton n'encode aucune
 *   information : il ne SIGNIFIE rien, il DÉSIGNE une ligne. Il n'y a donc
 *   aucune clé dont la fuite permettrait de le fabriquer ou de le lire.
 * - **La base ne garde que son empreinte.** SHA-256 suffit ici, là où un mot
 *   de passe exigerait bcrypt : un jeton de 256 bits aléatoires n'a pas de
 *   dictionnaire à essayer, et la lenteur d'un hachage dédié n'apporterait
 *   rien contre une force brute qui ne finira jamais.
 * - **Il expire en quinze jours.** Passé ce délai, le lien ne répond plus et
 *   le client en redemande un avec son adresse.
 */

/** Quinze jours, en millisecondes. */
const DUREE_MS = Number(process.env.SUIVI_LIEN_DUREE_JOURS || 15) * 24 * 60 * 60 * 1000;

/** Plafond de liens vivants par adresse : au-delà, les plus vieux tombent. */
const MAX_PAR_EMAIL = 5;

const empreinte = (jeton) => crypto.createHash('sha256').update(String(jeton)).digest('hex');

const normaliserEmail = (email) => String(email || '').trim().toLowerCase();

class LienSuiviService {
  /**
   * L'adresse publique d'un lien, telle que le client la recevra.
   * Elle vit ici et non dans VitrineService : le service des commandes en a
   * besoin à chaque changement de statut, et dépendre de VitrineService
   * créerait un cycle entre les deux.
   */
  static url(jeton) {
    const base = (process.env.VITRINE_BASE_URL || 'https://saambiz.com').replace(/\/+$/, '');
    return `${base}/suivi/${jeton}`;
  }

  /** La durée de validité, pour l'écrire dans les emails et les réponses. */
  static get dureeJours() {
    return Math.round(DUREE_MS / (24 * 60 * 60 * 1000));
  }

  /**
   * Fabrique un lien pour cette adresse. Rend le jeton EN CLAIR — c'est la
   * seule fois où il existe ailleurs que dans l'email du client.
   */
  static async creer(email, commandeId = null) {
    const adresse = normaliserEmail(email);
    if (!estEmailValide(adresse)) {
      throw new BadRequestError('Adresse email invalide.');
    }

    const jeton = crypto.randomBytes(32).toString('base64url');
    const lien = await LienSuivi.create({
      email: adresse,
      jetonHash: empreinte(jeton),
      expiresAt: new Date(Date.now() + DUREE_MS),
      commandeId,
    });

    // Un client qui commande dix fois ne doit pas laisser dix portes
    // ouvertes : on ne garde que les plus récentes.
    await LienSuiviService._elaguer(adresse);

    return { jeton, expiresAt: lien.expiresAt };
  }

  /** Supprime les liens expirés et les plus anciens au-delà du plafond. */
  static async _elaguer(email) {
    await LienSuivi.destroy({
      where: { email, expiresAt: { [Op.lt]: new Date() } },
    });
    const vivants = await LienSuivi.findAll({
      where: { email },
      order: [['createdAt', 'DESC']],
      attributes: ['id'],
    });
    if (vivants.length > MAX_PAR_EMAIL) {
      const aSupprimer = vivants.slice(MAX_PAR_EMAIL).map((l) => l.id);
      await LienSuivi.destroy({ where: { id: { [Op.in]: aSupprimer } } });
    }
  }

  /**
   * Ouvre un lien. Trois issues, et elles ne se confondent pas :
   * le lien est valable, il a expiré, ou il n'existe pas. L'écran « lien
   * expiré » doit pouvoir le dire au client, qui n'y peut rien.
   */
  static async ouvrir(jeton) {
    if (!jeton || typeof jeton !== 'string' || jeton.length > 200) {
      throw new NotFoundError('Ce lien de suivi est introuvable.');
    }

    const lien = await LienSuivi.findOne({ where: { jetonHash: empreinte(jeton) } });
    if (!lien) {
      throw new NotFoundError('Ce lien de suivi est introuvable.');
    }

    if (lien.expiresAt.getTime() <= Date.now()) {
      // 410 Gone : la ressource a existé et n'existe plus. Le front s'en sert
      // pour afficher « lien expiré » plutôt que « lien inconnu ».
      const erreur = new Error('Ce lien de suivi a expiré.');
      erreur.status = 410;
      erreur.code = 'LIEN_EXPIRE';
      throw erreur;
    }

    await lien.update({ derniereUtilisation: new Date() });

    const commandes = await LienSuiviService.commandesDe(lien.email);
    return {
      email: lien.email,
      expireLe: lien.expiresAt,
      commandeOuverte: lien.commandeId || commandes[0]?.id || null,
      commandes,
    };
  }

  /**
   * Les commandes d'une adresse, de la plus récente à la plus ancienne.
   *
   * Seules celles passées SANS COMPTE depuis le site d'une boutique : une
   * commande faite depuis l'application appartient à un compte, et se suit
   * en s'y connectant. Mélanger les deux ferait du lien une porte dérobée
   * vers les commandes d'un compte dont on ne connaît que l'adresse.
   */
  static async commandesDe(email) {
    const adresse = normaliserEmail(email);
    const commandes = await Commande.findAll({
      where: { clientEmail: adresse, acheteurId: null },
      include: [
        {
          model: LigneCommande,
          as: 'lignes',
          attributes: ['nomProduit', 'imageProduit', 'quantite', 'prixUnitaire', 'sousTotal'],
        },
      ],
      order: [['createdAt', 'DESC']],
      limit: 50,
    });

    const boutiques = await LienSuiviService._boutiquesDe(commandes);

    return commandes.map((c) => ({
      id: c.id,
      reference: c.referenceCommande,
      statut: c.statut,
      statutPaiement: c.statutPaiement,
      modeLivraison: c.modeLivraison,
      modePaiement: c.modePaiement,
      adresseLivraison: c.adresseLivraison,
      montantProduits: c.montantProduits,
      fraisLivraison: c.fraisLivraison,
      montantTotal: c.montantTotal,
      note: c.note,
      annulationDemandeeLe: c.annulationDemandeeLe,
      annulationRefusMotif: c.annulationRefusMotif,
      creeeLe: c.createdAt,
      majLe: c.updatedAt,
      boutique: boutiques.get(c.vendeurId) || null,
      lignes: (c.lignes || []).map((l) => ({
        nom: l.nomProduit,
        image: l.imageProduit,
        quantite: l.quantite,
        prixUnitaire: l.prixUnitaire,
        sousTotal: l.sousTotal,
      })),
    }));
  }

  /** Les boutiques concernées, en une requête plutôt qu'une par commande. */
  static async _boutiquesDe(commandes) {
    const vendeurIds = [...new Set(commandes.map((c) => c.vendeurId).filter(Boolean))];
    if (vendeurIds.length === 0) return new Map();
    const boutiques = await Boutique.findAll({
      where: { vendeurId: { [Op.in]: vendeurIds } },
      attributes: ['vendeurId', 'nom', 'slug', 'logo', 'telephone', 'whatsapp'],
    });
    return new Map(boutiques.map((b) => [b.vendeurId, {
      nom: b.nom,
      slug: b.slug,
      logo: b.logo,
      telephone: b.whatsapp || b.telephone,
    }]));
  }

  /**
   * Un lien valable pour cette adresse : le plus récent encore vivant ne
   * peut pas être réutilisé — son jeton en clair n'existe plus nulle part —
   * on en fabrique donc un neuf à chaque envoi.
   */
  static async pourEmail(email, commandeId = null) {
    const adresse = normaliserEmail(email);
    if (!estEmailValide(adresse)) return null;
    return LienSuiviService.creer(adresse, commandeId);
  }

  /** Y a-t-il seulement des commandes derrière cette adresse ? */
  static async aDesCommandes(email) {
    const adresse = normaliserEmail(email);
    if (!estEmailValide(adresse)) return false;
    const n = await Commande.count({ where: { clientEmail: adresse, acheteurId: null } });
    return n > 0;
  }
}

module.exports = LienSuiviService;
module.exports.empreinte = empreinte;
