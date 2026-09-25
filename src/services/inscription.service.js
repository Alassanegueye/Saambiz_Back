// services/inscription.service.js
//
// Vérification de l'adresse email AVANT la création du compte.
//
// L'ordre compte. Créer le compte puis demander un code laissait une ligne
// utilisateur définitive derrière chaque adresse jamais confirmée — fautes de
// frappe comprises — et n'empêchait rien : la connexion ne regardait pas le
// drapeau `verifie`. Désormais, le compte n'existe qu'une fois le code validé.
//
// Le parcours tient en trois appels :
//   1. envoyerCode(email)            → un code à six chiffres part par mail
//   2. verifierCode(email, code)     → rend un jeton à usage unique
//   3. register(..., jetonEmail)     → le compte est créé, déjà vérifié
//
// Le jeton de l'étape 2 n'est pas une commodité : sans lui, entre le moment où
// le propriétaire de l'adresse valide son code et celui où il remplit le
// formulaire, n'importe qui connaissant cette adresse pourrait s'inscrire à sa
// place. Le jeton lie la création du compte à cette vérification-là.

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { VerificationEmail, Utilisateur } = require('../models');
const { sendVerificationEmail } = require('./resend.service');
const { bcryptConfig } = require('../config/security');
const { BadRequestError, ConflictError, TooManyRequestsError } = require('../errors/AppError');
const logger = require('../utils/logger');

// Quinze minutes : le temps d'ouvrir sa boîte mail, y compris quand le message
// traîne quelques minutes en route.
const VALIDITE_CODE_MS = 15 * 60 * 1000;

// Trente minutes après la validation pour finir de remplir le formulaire.
const VALIDITE_JETON_MS = 30 * 60 * 1000;

// Six chiffres se devinent en un million de coups, ce qui est peu pour une
// machine. Au-delà de cinq essais, il faut redemander un code — ce qui en
// génère un nouveau et remet le compteur à zéro.
const ESSAIS_MAX = 5;

// Un code ne peut pas être redemandé plus souvent : sinon la route devient un
// moyen d'inonder une boîte mail qu'on ne possède pas.
const DELAI_RENVOI_MS = 30 * 1000;

const normaliser = (email) => String(email || '').trim().toLowerCase();

const hacher = (valeur) => crypto.createHash('sha256').update(valeur).digest('hex');

/** Six chiffres, tirés d'une source cryptographique. */
const genererCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

class InscriptionService {

  // ══════════════════════════════════════════════════════════════════
  //  1. ENVOYER LE CODE
  // ══════════════════════════════════════════════════════════════════

  static async envoyerCode(email, { prenom } = {}) {
    const adresse = normaliser(email);
    if (!/^\S+@\S+\.\S+$/.test(adresse)) {
      throw new BadRequestError('Adresse email invalide.');
    }

    // Une adresse déjà inscrite ne repart pas dans ce parcours : le message
    // est explicite plutôt que de laisser l'utilisateur saisir un code pour
    // découvrir l'échec à l'étape suivante.
    const existant = await Utilisateur.findOne({ where: { email: adresse } });
    if (existant) {
      throw new ConflictError(
        'Cette adresse est déjà associée à un compte. Connectez-vous, ou utilisez « mot de passe oublié ».'
      );
    }

    const enCours = await VerificationEmail.findByPk(adresse);
    if (enCours) {
      const depuis = Date.now() - new Date(enCours.updatedAt).getTime();
      if (depuis < DELAI_RENVOI_MS) {
        const reste = Math.ceil((DELAI_RENVOI_MS - depuis) / 1000);
        throw new TooManyRequestsError(
          `Un code vient d'être envoyé. Patientez ${reste} seconde${reste > 1 ? 's' : ''}.`
        );
      }
    }

    const code = genererCode();
    const valeurs = {
      email: adresse,
      codeHash: await bcrypt.hash(code, bcryptConfig.saltRounds),
      expiresAt: new Date(Date.now() + VALIDITE_CODE_MS),
      // Un nouveau code remet le compteur d'essais à zéro et annule le jeton
      // éventuellement déjà remis : il n'y a jamais deux codes valides.
      tentatives: 0,
      jetonHash: null,
      jetonExpireLe: null,
    };

    if (enCours) await enCours.update(valeurs);
    else await VerificationEmail.create(valeurs);

    await InscriptionService._envoyer(adresse, prenom, code);

    return {
      message: `Un code à 6 chiffres a été envoyé à ${adresse}.`,
      expireDans: Math.round(VALIDITE_CODE_MS / 1000),
    };
  }

  /**
   * L'envoi proprement dit.
   *
   * En développement sans clé Resend, le code est écrit dans les journaux :
   * sans cela le parcours est intestable en local — le service avale l'e-mail
   * en silence et on attend un message qui ne partira jamais. Jamais en
   * production, où ce serait divulguer le code dans les journaux.
   */
  static async _envoyer(adresse, prenom, code) {
    const enProduction = process.env.NODE_ENV === 'production';

    try {
      await sendVerificationEmail({ to: adresse, nom: prenom || '', code });
    } catch (err) {
      logger.error('[inscription] envoi du code impossible', { message: err.message });
      throw new BadRequestError(
        "Le code n'a pas pu être envoyé. Vérifiez l'adresse saisie et réessayez."
      );
    }

    if (!enProduction && !process.env.RESEND_API_KEY) {
      logger.warn(
        `[inscription] e-mails désactivés — code de vérification pour ${adresse} : ${code}`
      );
    }
  }

  // ══════════════════════════════════════════════════════════════════
  //  2. VÉRIFIER LE CODE
  // ══════════════════════════════════════════════════════════════════

  static async verifierCode(email, code) {
    const adresse = normaliser(email);
    const saisi = String(code || '').trim();

    const ligne = await VerificationEmail.findByPk(adresse);
    // Même message pour une adresse inconnue et un code expiré : distinguer
    // les deux dirait à un tiers quelles adresses ont demandé un code.
    if (!ligne || ligne.expiresAt < new Date()) {
      throw new BadRequestError('Code expiré ou inconnu. Demandez-en un nouveau.');
    }

    if (ligne.tentatives >= ESSAIS_MAX) {
      throw new TooManyRequestsError(
        'Trop d\'essais infructueux. Demandez un nouveau code.'
      );
    }

    const valide = await bcrypt.compare(saisi, ligne.codeHash);
    if (!valide) {
      await ligne.increment('tentatives');
      const restants = ESSAIS_MAX - (ligne.tentatives + 1);
      throw new BadRequestError(
        restants > 0
          ? `Code incorrect. Il vous reste ${restants} essai${restants > 1 ? 's' : ''}.`
          : 'Code incorrect. Demandez un nouveau code.'
      );
    }

    // Valeur aléatoire opaque, remise une fois. Son empreinte seule est
    // conservée : une lecture de la base ne permet pas de s'inscrire.
    const jeton = crypto.randomBytes(32).toString('hex');
    await ligne.update({
      jetonHash: hacher(jeton),
      jetonExpireLe: new Date(Date.now() + VALIDITE_JETON_MS),
      tentatives: 0,
    });

    return {
      jetonEmail: jeton,
      expireDans: Math.round(VALIDITE_JETON_MS / 1000),
    };
  }

  // ══════════════════════════════════════════════════════════════════
  //  3. CONSOMMER LE JETON, À L'INSCRIPTION
  // ══════════════════════════════════════════════════════════════════

  /**
   * Vérifie que cette adresse a bien été confirmée, et referme le dossier.
   *
   * Appelé par `AuthService.register`, à l'intérieur de sa transaction :
   * si la création du compte échoue ensuite, la ligne de vérification est
   * restaurée avec elle et le jeton reste utilisable.
   */
  static async consommerJeton(email, jetonEmail, transaction = null) {
    const adresse = normaliser(email);
    const jeton = String(jetonEmail || '').trim();

    if (!jeton) {
      throw new BadRequestError(
        'Vérifiez votre adresse email avant de créer votre compte.'
      );
    }

    const ligne = await VerificationEmail.findByPk(adresse, { transaction });
    if (!ligne || !ligne.jetonHash || ligne.jetonExpireLe < new Date()) {
      throw new BadRequestError(
        'Votre vérification a expiré. Recommencez avec un nouveau code.'
      );
    }

    // Comparaison à temps constant : une comparaison naïve fuit, par sa durée,
    // la longueur du préfixe correct.
    const attendu = Buffer.from(ligne.jetonHash);
    const recu = Buffer.from(hacher(jeton));
    if (attendu.length !== recu.length || !crypto.timingSafeEqual(attendu, recu)) {
      throw new BadRequestError(
        'Votre vérification a expiré. Recommencez avec un nouveau code.'
      );
    }

    await ligne.destroy({ transaction });
  }

  // ══════════════════════════════════════════════════════════════════
  //  ENTRETIEN
  // ══════════════════════════════════════════════════════════════════

  /**
   * Supprime les vérifications abandonnées — la majorité des lignes, un code
   * demandé n'étant pas toujours saisi. Appelé par le cron de purge.
   */
  static async purger() {
    const supprimees = await VerificationEmail.destroy({
      where: {
        expiresAt: { [Op.lt]: new Date() },
        [Op.or]: [
          { jetonExpireLe: null },
          { jetonExpireLe: { [Op.lt]: new Date() } },
        ],
      },
    });
    if (supprimees) logger.info(`[inscription] ${supprimees} vérification(s) expirée(s) purgée(s)`);
    return supprimees;
  }
}

module.exports = InscriptionService;
