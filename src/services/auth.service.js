const { Utilisateur, Boutique, Abonnement, TokenBlacklist, UserOtp } = require('../models');
const InscriptionService = require('./inscription.service');
const { sendWelcomeEmail, sendVerificationEmail } = require('./resend.service');
const logger = require('../utils/logger');

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomInt } = require('crypto');
const { jwtConfig, bcryptConfig } = require('../config/security');

// Hash bcrypt d'une valeur arbitraire, calculé une fois au chargement du
// module. Sert uniquement à égaliser le temps de réponse du login quand
// l'utilisateur n'existe pas (voir AuthService.login).
const HASH_FACTICE = bcrypt.hashSync('mot_de_passe_factice_anti_timing', 12);
const sequelize = require('../config/db');
const { uploadImage } = require('../middlewares/uploadService');
const { appliquerDefautsBoutique, genererSlugUnique } = require('../utils/boutiqueDefaults');

class AuthService {

  // ==============================
  // REGISTER
  // ==============================
  static async register({
    nom,
    prenom,
    email,
    mot_de_passe,
    adresse,
    telephone,
    photoProfil,
    role = 'Acheteur',
    boutique,
    // Remis par /auth/inscription/verifier-code. L'adresse a donc déjà été
    // confirmée : le compte naît vérifié, et aucune adresse jamais confirmée
    // ne laisse de ligne utilisateur derrière elle.
    jetonEmail,
  }) {
    const t = await sequelize.transaction();

    try {
      const emailClean = email.trim().toLowerCase();

      // Dans la transaction : si la création échoue plus bas, la ligne de
      // vérification revient avec elle et le jeton reste utilisable.
      await InscriptionService.consommerJeton(emailClean, jetonEmail, t);

      const exist = await Utilisateur.findOne({
        where: { email: emailClean },
        transaction: t
      });

      if (exist) {
        await t.rollback();
        return { success: false, message: "Cet email est déjà utilisé" };
      }

      const hashedPassword = await bcrypt.hash(mot_de_passe, bcryptConfig.saltRounds);

      // `telephone` est unique : sans ce contrôle, l'insertion échouerait sur
      // une contrainte et l'utilisateur verrait une erreur technique là où il
      // attend une phrase.
      if (telephone) {
        const parTelephone = await Utilisateur.findOne({
          where: { telephone },
          transaction: t,
        });

        if (parTelephone) {
          await t.rollback();
          return { success: false, message: 'Ce numéro de téléphone est déjà utilisé' };
        }
      }

      let photoUrl = null;
      if (photoProfil?.buffer) {
        photoUrl = await uploadImage(photoProfil.buffer);
      }

      const utilisateur = await Utilisateur.create({
        nom,
        prenom,
        email: emailClean,
        mot_de_passe: hashedPassword,
        adresse: adresse || null,
        telephone,
        photoProfil: photoUrl,
        role,
        // L'adresse vient d'être confirmée par code : la vérifier une seconde
        // fois après coup n'aurait aucun sens.
        verifie: true,
      }, { transaction: t });

      let abonnementData = null;
      let boutiqueCreated = null;

      if (role === 'Vendeur') {
        const dateDebut = new Date();
        const dateFin = new Date();
        dateFin.setMonth(dateFin.getMonth() + 1);

        const abonnement = await Abonnement.create({
          utilisateurId: utilisateur.id,
          type: 'essai',
          dateDebut,
          dateFin,
          montant: 0
        }, { transaction: t });

        abonnementData = {
          id: abonnement.id,
          type: abonnement.type,
          statut: abonnement.statut,
          dateDebut: abonnement.dateDebut,
          dateFin: abonnement.dateFin,
          montant: abonnement.montant
        };

        if (boutique) {
          const existBoutique = await Boutique.findOne({
            where: { telephone: boutique.telephone },
            transaction: t
          });

          if (existBoutique) {
            await t.rollback();
            return {
              success: false,
              message: "Ce numéro de téléphone est déjà utilisé par une autre boutique"
            };
          }

          let logoUrl = null;
          if (boutique?.logo?.buffer) {
            logoUrl = await uploadImage(boutique.logo.buffer);
          }

          // Applique le modèle de boutique par défaut + slug unique
          const donneesBoutique = appliquerDefautsBoutique({
            nom: boutique.nom,
            description: boutique.description,
            localisation: boutique.localisation,
            categorie: boutique.categorie,
            slogan: boutique.slogan,
            telephone: boutique.telephone,
          });
          donneesBoutique.slug = await genererSlugUnique(boutique.nom);

          boutiqueCreated = await Boutique.create({
            ...donneesBoutique,
            logo: logoUrl,
            vendeurId: utilisateur.id
          }, { transaction: t });
        }
      }

      // MED-03 : générer token de vérification email (24h)
      const verificationCode = randomInt(100000, 1000000).toString();
      const verificationHash = await bcrypt.hash(verificationCode, 10);
      await UserOtp.create({
        utilisateurId: utilisateur.id,
        otpHash: verificationHash,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
      }, { transaction: t });

      await t.commit();

      // Emails en arrière-plan (non bloquants)
      sendWelcomeEmail({
        to: emailClean,
        nom: utilisateur.nom,
        prenom: utilisateur.prenom,
        role: utilisateur.role
      }).catch(() => {});

      sendVerificationEmail({
        to: emailClean,
        nom: utilisateur.nom,
        code: verificationCode,
      }).catch(() => {});

      return {
        success: true,
        message: "Inscription réussie. Votre adresse email est vérifiée.",
        utilisateur,
        abonnement: abonnementData,
        boutique: boutiqueCreated
      };

    } catch (err) {
      await t.rollback();

      // Une erreur métier typée porte un message écrit pour l'utilisateur —
      // « Votre vérification a expiré », « Ce numéro est déjà utilisé ». La
      // masquer derrière « erreur serveur » laissait la personne sans la
      // moindre idée de ce qu'elle devait corriger. On la laisse remonter au
      // gestionnaire global, qui la traduit en son propre code HTTP.
      if (err && err.isOperational) throw err;

      logger.error('auth.register', { message: err.message });
      return {
        success: false,
        message: "Erreur serveur lors de l'inscription"
      };
    }
  }

  // ==============================
  // VÉRIFICATION EMAIL — MED-03
  // ==============================
  static async verifierEmail(email, code) {
    const utilisateur = await Utilisateur.findOne({ where: { email: email.trim().toLowerCase() } });
    if (!utilisateur) return { success: false, message: 'Email introuvable' };

    if (utilisateur.verifie) {
      return { success: true, message: 'Email déjà vérifié' };
    }

    const otpRecord = await UserOtp.findOne({
      where: {
        utilisateurId: utilisateur.id,
        expiresAt: { [require('sequelize').Op.gte]: new Date() }
      },
      order: [['createdAt', 'DESC']]
    });

    if (!otpRecord) return { success: false, message: 'Code expiré ou invalide. Relancez l\'inscription.' };

    const valid = await bcrypt.compare(code, otpRecord.otpHash);
    if (!valid) return { success: false, message: 'Code de vérification incorrect' };

    await utilisateur.update({ verifie: true });
    await otpRecord.destroy();

    return { success: true, message: 'Email vérifié avec succès. Vous pouvez maintenant vous connecter.' };
  }

  // ==============================
  // RENVOI DU CODE DE VÉRIFICATION
  // ==============================
  // Le mobile propose « Renvoyer le code » après 30 s : on invalide les codes
  // précédents et on en émet un nouveau, valable 24 h comme à l'inscription.
  static async renvoyerCodeVerification(email) {
    const emailClean = String(email || '').trim().toLowerCase();
    const utilisateur = await Utilisateur.findOne({ where: { email: emailClean } });
    // Réponse volontairement identique si l'email n'existe pas : on n'indique
    // pas à un tiers quelles adresses sont inscrites.
    if (!utilisateur) {
      return { success: true, message: "Si un compte existe, un code vient d'être envoyé." };
    }
    if (utilisateur.verifie) {
      return { success: true, message: 'Email déjà vérifié' };
    }

    await UserOtp.destroy({ where: { utilisateurId: utilisateur.id } });

    const verificationCode = randomInt(100000, 1000000).toString();
    await UserOtp.create({
      utilisateurId: utilisateur.id,
      otpHash: await bcrypt.hash(verificationCode, 10),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    sendVerificationEmail({
      to: emailClean,
      nom: utilisateur.nom,
      code: verificationCode,
    }).catch(() => {});

    return { success: true, message: 'Un nouveau code vient de vous être envoyé.' };
  }

  // ==============================
  // LOGIN
  // ==============================
  static async login({ identifiant, mot_de_passe }, contexte = {}) {
    try {
      const isEmail = /\S+@\S+\.\S+/.test(identifiant);

      const utilisateur = await Utilisateur.findOne({
        where: isEmail ? { email: identifiant } : { telephone: identifiant },
        include: [
          {
            model: Abonnement,
            as: 'abonnements',
            required: false
          }
        ],
        order: [[{ model: Abonnement, as: 'abonnements' }, 'createdAt', 'DESC']]
      });

      if (!utilisateur) {
        // Comparaison à vide contre un hash factice : sans elle, un compte
        // inexistant répond en ~1 ms là où un compte existant coûte le temps
        // d'un bcrypt à 12 tours (~200 ms). L'écart est mesurable et permet
        // de dresser la liste des adresses inscrites. On paie donc le même
        // prix dans les deux cas.
        await bcrypt.compare(mot_de_passe, HASH_FACTICE);
        return { success: false, error: 'Identifiant ou mot de passe incorrect' };
      }

      if (utilisateur.statut !== 'actif') {
        return { success: false, error: `Votre compte est ${utilisateur.statut}` };
      }

      const valid = await bcrypt.compare(mot_de_passe, utilisateur.mot_de_passe);
      if (!valid) {
        return { success: false, message: 'Identifiant ou mot de passe incorrect' };
      }

      const token = jwt.sign({
        id: utilisateur.id,
        nom: utilisateur.nom,
        prenom: utilisateur.prenom,
        email: utilisateur.email,
        role: utilisateur.role,
      }, jwtConfig.secret, { expiresIn: jwtConfig.expiresIn });

      // Le refresh est enregistré hashé : il devient révocable, plafonné
      // par compte, et purgeable. Voir RefreshTokenService.
      const RefreshTokenService = require('./refreshToken.service');
      const refreshToken = await RefreshTokenService.emettre(utilisateur.id, contexte);

      // Récupérer les menus accessibles selon les permissions RBAC
      const { Permission, Menu } = require('../models');
      const permissionsData = await Permission.findAll({
        where: { userId: utilisateur.id },
        include: [{ model: Menu, as: 'menu', where: { isActive: true }, required: false }],
      });
      const menus = permissionsData
        .filter((p) => p.canView && p.menu)
        .map((p) => ({
          id:   p.menu.id,
          name: p.menu.name,
          code: p.menu.code,
          path: p.menu.path,
          icon: p.menu.icon,
          permissions: {
            canView:   p.canView,
            canCreate: p.canCreate,
            canUpdate: p.canUpdate,
            canDelete: p.canDelete,
          },
        }));

      return {
        success: true,
        message: "Connexion réussie",
        token,
        refreshToken,
        utilisateur: { ...utilisateur.toJSON(), isFirstLogin: utilisateur.isFirstLogin },
        abonnement: utilisateur.abonnements?.[0] || null,
        menus,
      };

    } catch (error) {
      // CRIT-03 : logger structuré, pas de console.error + stack trace brute
      logger.error('auth.login', { message: error.message });
      throw error;
    }
  }

  // ==============================
  // LOGOUT
  // ==============================
  /**
   * Déconnexion : le jeton d'accès part en liste noire jusqu'à son expiration
   * naturelle, le refresh est révoqué en base. Sans le second, la session
   * pouvait se reconstituer aussitôt.
   */
  static async logout(token, expiresAt, refreshToken = null) {
    await TokenBlacklist.create({ token, expiresAt });
    if (refreshToken) {
      const RefreshTokenService = require('./refreshToken.service');
      await RefreshTokenService.revoquer(refreshToken);
    }
    return { success: true, message: 'Déconnexion réussie' };
  }

  // ==============================
  // CHANGER MOT DE PASSE
  // ==============================
  static async changerMotDePasse(userId, ancienMotDePasse, nouveauMotDePasse, confirmation) {
    if (nouveauMotDePasse !== confirmation) {
      throw Object.assign(
        new Error('Le nouveau mot de passe et la confirmation ne correspondent pas.'),
        { status: 400 }
      );
    }

    const utilisateur = await Utilisateur.findByPk(userId);
    if (!utilisateur) throw Object.assign(new Error('Utilisateur introuvable.'), { status: 404 });

    const valid = await bcrypt.compare(ancienMotDePasse, utilisateur.mot_de_passe);
    if (!valid) throw Object.assign(new Error('Ancien mot de passe incorrect.'), { status: 401 });

    // Validation de la politique de mot de passe
    const { passwordSchema } = require('../validators/auth.validator');
    const { error } = passwordSchema.validate(nouveauMotDePasse);
    if (error) throw Object.assign(new Error(error.message), { status: 400 });

    const hash = await bcrypt.hash(nouveauMotDePasse, bcryptConfig.saltRounds);
    await utilisateur.update({ mot_de_passe: hash, isFirstLogin: false });

    // On change son mot de passe précisément quand on soupçonne une fuite :
    // laisser vivre les sessions ouvertes ailleurs viderait le geste de son sens.
    const RefreshTokenService = require('./refreshToken.service');
    await RefreshTokenService.revoquerTout(userId);

    return { message: 'Mot de passe modifié avec succès. Vos autres sessions ont été fermées.' };
  }

  // ==============================
  // REFRESH TOKEN
  // ==============================
  /**
   * Rafraîchit une session.
   *
   * Le jeton présenté est vérifié contre la base — signature valide ne suffit
   * plus — puis remplacé. Un refresh ne sert donc qu'une fois : présenté deux
   * fois, la seconde tentative échoue, ce qui rend un vol visible.
   */
  static async refreshToken(refreshToken, contexte = {}) {
    const RefreshTokenService = require('./refreshToken.service');

    const rotation = await RefreshTokenService.faireTourner(refreshToken, contexte);
    if (!rotation.valide) {
      return { success: false, message: rotation.motif };
    }

    const utilisateur = await Utilisateur.findByPk(rotation.utilisateurId);
    if (!utilisateur) {
      return { success: false, message: 'Utilisateur introuvable' };
    }
    if (utilisateur.statut !== 'actif') {
      // Compte suspendu entre-temps : on coupe toutes ses sessions.
      await RefreshTokenService.revoquerTout(utilisateur.id);
      return { success: false, message: `Votre compte est ${utilisateur.statut}` };
    }

    const newToken = jwt.sign({
      id: utilisateur.id,
      nom: utilisateur.nom,
      prenom: utilisateur.prenom,
      email: utilisateur.email,
      role: utilisateur.role,
    }, jwtConfig.secret, { expiresIn: jwtConfig.expiresIn });

    return { success: true, token: newToken, refreshToken: rotation.token };
  }
}

module.exports = AuthService;
