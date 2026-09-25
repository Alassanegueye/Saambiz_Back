// services/vitrine/assistant.service.js
//
// L'assistant de création du site d'une boutique.
//
// Le vendeur ne remplit pas quinze champs : il téléverse son logo, dit ce
// qu'il vend, et le site est composé. C'est la seule façon d'obtenir un site
// correct de quelqu'un qui gère son commerce depuis un téléphone, entre deux
// clients — et un site composé pour lui vaut mieux qu'un site vide qu'il
// n'aura jamais le temps de remplir.
//
// Trois sources alimentent la composition :
//   1. le LOGO — ses couleurs deviennent celles du site, sa forme décide de
//      son habillage dans l'en-tête (voir logo.analyse.service.js) ;
//   2. le SECTEUR déclaré — il choisit la mise en page et le ton des textes :
//      la mode se montre en grand, l'électronique se compare en liste ;
//   3. ce que le vendeur écrit de son activité — repris tel quel dans la
//      présentation, parce que ses mots valent mieux que les nôtres.
//
// Rien n'est définitif. L'assistant PROPOSE, le vendeur relit et corrige :
// la dernière étape est un aperçu, pas une validation.

const { Boutique, Produit } = require('../../models');
const { uploadImage } = require('../../middlewares/uploadService');
const LogoAnalyseService = require('./logo.analyse.service');
const { genererSlugUnique } = require('../../utils/boutiqueDefaults');
const { BadRequestError, NotFoundError } = require('../../errors/AppError');
const logger = require('../../utils/logger');

/**
 * Les secteurs proposés.
 *
 * La liste est courte exprès : un vendeur qui ne se reconnaît dans aucune
 * case coche « Autre » et le site reste bon. Vingt cases le feraient hésiter
 * sur la première question, et l'abandon se joue là.
 *
 * `modele` est la mise en page recommandée — pas imposée : le vendeur peut en
 * changer à l'étape suivante.
 */
const SECTEURS = [
  {
    cle: 'mode',
    libelle: 'Mode et habillement',
    exemples: 'Vêtements, tissus, chaussures, sacs',
    // Ce qui se vend par la photo se montre en grand.
    modele: 'galerie',
    accroche: (nom) => `Le style ${nom}, à votre portée`,
    presentation: (nom, ville) =>
      `${nom} habille sa clientèle${ville ? ` à ${ville}` : ''} avec des pièces choisies une par une.\n\nPassez commande directement depuis ce site : nous vous rappelons pour confirmer, et vous êtes livré ou vous retirez sur place.`,
  },
  {
    cle: 'beaute',
    libelle: 'Beauté et soins',
    exemples: 'Cosmétiques, cheveux, parfums, produits naturels',
    modele: 'galerie',
    accroche: () => 'Prenez soin de vous, simplement',
    presentation: (nom, ville) =>
      `${nom} sélectionne des produits de beauté et de soin${ville ? ` pour sa clientèle de ${ville}` : ''}.\n\nCommandez en ligne, nous vous rappelons pour confirmer votre commande.`,
  },
  {
    cle: 'alimentation',
    libelle: 'Alimentation',
    exemples: 'Épicerie, produits frais, boissons, plats préparés',
    // Un catalogue alimentaire se parcourt vite, on n'y flâne pas.
    modele: 'catalogue',
    accroche: () => 'Vos courses, livrées près de chez vous',
    presentation: (nom, ville) =>
      `${nom} vous propose ses produits${ville ? ` avec livraison à ${ville}` : ''}.\n\nChoisissez ce qu'il vous faut, passez commande, et nous vous rappelons pour la livraison.`,
  },
  {
    cle: 'electronique',
    libelle: 'Électronique et téléphonie',
    exemples: 'Téléphones, accessoires, informatique, électroménager',
    // On y compare des références et des prix : la liste dense l'emporte.
    modele: 'catalogue',
    accroche: () => 'Le bon appareil, au bon prix',
    presentation: (nom, ville) =>
      `${nom} vend et conseille sur l'électronique${ville ? ` à ${ville}` : ''}.\n\nTous les prix sont affichés sur ce site. Commandez en ligne ou appelez-nous pour un conseil.`,
  },
  {
    cle: 'maison',
    libelle: 'Maison et décoration',
    exemples: 'Meubles, décoration, ustensiles, literie',
    modele: 'galerie',
    accroche: () => 'De belles choses pour votre intérieur',
    presentation: (nom, ville) =>
      `${nom} meuble et décore les intérieurs${ville ? ` de ${ville}` : ''}.\n\nDécouvrez le catalogue et commandez en quelques gestes.`,
  },
  {
    cle: 'artisanat',
    libelle: 'Artisanat et fait main',
    exemples: 'Bijoux, poterie, cuir, objets faits main',
    modele: 'galerie',
    accroche: () => 'Fait main, pièce par pièce',
    presentation: (nom, ville) =>
      `Chez ${nom}, chaque pièce est faite à la main${ville ? ` dans notre atelier de ${ville}` : ''}.\n\nLes quantités sont limitées : ce que vous voyez sur ce site est ce qui reste disponible.`,
  },
  {
    cle: 'services',
    libelle: 'Services',
    exemples: 'Couture, réparation, coiffure, prestations',
    // Un prestataire montre peu d'articles : la mise en page sobre convient.
    modele: 'classique',
    accroche: () => 'Un savoir-faire à votre service',
    presentation: (nom, ville) =>
      `${nom} met son savoir-faire au service de ses clients${ville ? ` à ${ville}` : ''}.\n\nÉcrivez-nous ou appelez-nous pour un devis, ou commandez directement une prestation depuis ce site.`,
  },
  {
    cle: 'autre',
    libelle: 'Autre activité',
    exemples: 'Tout le reste',
    modele: 'classique',
    accroche: () => 'Bienvenue dans notre boutique',
    presentation: (nom, ville) =>
      `${nom} vous accueille sur sa boutique en ligne${ville ? `, depuis ${ville}` : ''}.\n\nParcourez le catalogue et passez commande directement : nous vous rappelons pour confirmer.`,
  },
];

const parSecteur = (cle) => SECTEURS.find((s) => s.cle === cle) || SECTEURS[SECTEURS.length - 1];

/** Horaires proposés par défaut — les plus courants au Sénégal. */
const HORAIRES_DEFAUT = 'Lundi à samedi, 9h — 19h';

class AssistantService {

  /** Ce que l'application affiche à la première étape du questionnaire. */
  static getSecteurs() {
    return SECTEURS.map(({ cle, libelle, exemples, modele }) => ({
      cle, libelle, exemples, modeleRecommande: modele,
    }));
  }

  // ══════════════════════════════════════════════════════════════════
  //  ÉTAPE 1 — LE LOGO
  // ══════════════════════════════════════════════════════════════════

  /**
   * Analyse le logo sans rien enregistrer.
   *
   * L'analyse est séparée de la génération pour que le vendeur VOIE ce qui a
   * été trouvé — les couleurs relevées, la forme détectée — et puisse changer
   * de logo avant de valider. Un logo imposé en silence sur la foi d'une
   * analyse ratée serait pire que pas d'analyse du tout.
   */
  static async analyserLogo(fichier) {
    if (!fichier || !fichier.buffer) {
      throw new BadRequestError('Choisissez une image de logo.');
    }
    return await LogoAnalyseService.analyserOuDefaut(fichier.buffer);
  }

  // ══════════════════════════════════════════════════════════════════
  //  ÉTAPE 2 — LA PROPOSITION
  // ══════════════════════════════════════════════════════════════════

  /**
   * Compose le site à partir des réponses, sans l'enregistrer.
   *
   * Le vendeur voit la proposition complète — mise en page, couleur, textes —
   * avant qu'elle n'existe. C'est ce qui rend l'étape « votre site est prêt »
   * honnête : il a déjà tout relu.
   */
  static composerProposition({ nomBoutique, ville, secteur, activite, analyse }) {
    const s = parSecteur(secteur);
    const nom = String(nomBoutique || 'Notre boutique').trim();
    const villeNette = String(ville || '').trim();

    // Ce que le vendeur écrit de son activité passe avant nos gabarits : ses
    // mots parlent de son commerce, les nôtres d'un commerce en général.
    const activiteNette = String(activite || '').trim();
    const presentation = activiteNette
      ? `${activiteNette}\n\n${s.presentation(nom, villeNette).split('\n\n').slice(1).join('\n\n')}`
      : s.presentation(nom, villeNette);

    return {
      modele: s.modele,
      accent: analyse?.accentPropose || '#0D1B3D',
      palette: analyse?.palette || [],
      logoForme: analyse?.forme || 'libre',
      placementLogo: analyse?.placement || 'libre',
      slogan: s.accroche(nom),
      apropos: presentation,
      horaires: HORAIRES_DEFAUT,
      // Pas d'annonce inventée : un bandeau « Livraison offerte » que le
      // vendeur n'a pas décidé serait une promesse faite à sa place.
      annonce: '',
      sections: { apropos: true, categories: true, avis: true, contact: true },
      pourquoi: {
        modele: AssistantService._expliquerModele(s),
        couleur: analyse?.couleurs?.length
          ? 'Cette couleur a été relevée dans votre logo. Le site en déduit tout le reste — boutons, bandeaux, bordures — en gardant le texte lisible.'
          : "Nous n'avons pas trouvé de couleur franche dans votre logo : le bleu SaamBiz est proposé par défaut. Vous pouvez en choisir une autre.",
        logo: analyse?.conseilForme || null,
      },
    };
  }

  static _expliquerModele(s) {
    const explications = {
      galerie: 'Vos produits se vendent par la photo : la mise en page « Galerie » les montre en grand.',
      catalogue: 'Vos clients comparent des références et des prix : la mise en page « Catalogue » se parcourt vite.',
      classique: 'La mise en page « Classique » convient à tous les catalogues : bannière, rayons, puis les produits.',
    };
    return explications[s.modele];
  }

  // ══════════════════════════════════════════════════════════════════
  //  ÉTAPE 3 — LA CRÉATION
  // ══════════════════════════════════════════════════════════════════

  /**
   * Crée le site et le publie.
   *
   * Appelé depuis l'application mobile, à la fin de l'assistant. Le tableau
   * de bord web ne propose pas cette étape : il renvoie vers l'application
   * tant que `vitrineConfiguree` est faux.
   */
  static async genererVitrine(vendeurId, reponses = {}, fichierLogo = null) {
    const boutique = await Boutique.findOne({ where: { vendeurId } });
    if (!boutique) {
      throw new NotFoundError("Créez d'abord votre boutique pour ouvrir votre site.");
    }

    // Lu avant la mise à jour : après, le drapeau vaut toujours vrai et
    // l'application ne saurait plus distinguer une création d'une reprise.
    const premiereCreation = !boutique.vitrineConfiguree;

    const maj = {};

    // ── Le logo ───────────────────────────────────────────────────────
    // Analysé à nouveau ici plutôt que de faire confiance à ce que renvoie
    // l'application : ce qu'un client envoie n'engage que lui, il pourrait
    // annoncer n'importe quelle forme ou couleur.
    let analyse = null;
    let logoEnregistre = true;

    if (fichierLogo?.buffer) {
      analyse = await LogoAnalyseService.analyserOuDefaut(fichierLogo.buffer);

      // L'hébergement des images est un service tiers : il tombe, il expire,
      // il refuse un format. Le vendeur, lui, vient de répondre à quatre
      // questions — lui refuser son site entier parce qu'une image n'est pas
      // partie serait le pire moment pour échouer. On crée donc le site sans
      // le logo, et on le lui dit : il l'ajoutera depuis « Ma boutique ».
      try {
        maj.logo = await uploadImage(fichierLogo.buffer);
        maj.vitrineLogoForme = analyse.forme;
        maj.vitrinePalette = analyse.palette;
      } catch (err) {
        logoEnregistre = false;
        logger.error('[vitrine] logo non téléversé, le site est créé sans lui', {
          message: err.message,
        });
      }
    }

    // ── Secteur et activité ───────────────────────────────────────────
    const secteur = parSecteur(reponses.secteur);
    maj.vitrineSecteur = secteur.cle;
    if (reponses.activite !== undefined) {
      maj.vitrineActivite = String(reponses.activite || '').trim().slice(0, 300) || null;
    }

    // ── Apparence ─────────────────────────────────────────────────────
    // Le choix du vendeur l'emporte toujours sur la recommandation : il a vu
    // la proposition et l'a modifiée en connaissance de cause.
    const MODELES = require('./vitrine.service').MODELES_VITRINE;
    maj.vitrineModele = MODELES.includes(reponses.modele) ? reponses.modele : secteur.modele;

    const accentChoisi = String(reponses.accent || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(accentChoisi)) {
      maj.vitrineAccent = accentChoisi.toUpperCase();
    } else if (analyse) {
      maj.vitrineAccent = analyse.accentPropose;
    }

    // ── Textes ────────────────────────────────────────────────────────
    const proposition = AssistantService.composerProposition({
      nomBoutique: boutique.nom,
      ville: boutique.ville || boutique.localisation,
      secteur: secteur.cle,
      activite: reponses.activite,
      analyse,
    });

    maj.vitrineApropos = String(reponses.apropos ?? proposition.apropos).trim().slice(0, 2000) || null;
    maj.vitrineHoraires = String(reponses.horaires ?? proposition.horaires).trim().slice(0, 160) || null;
    maj.vitrineAnnonce = String(reponses.annonce ?? '').trim().slice(0, 180) || null;

    // Le slogan appartient à la boutique, pas à la vitrine : il s'affiche
    // aussi dans l'application. On ne l'écrase donc que s'il est vide, ou si
    // le vendeur en a explicitement saisi un nouveau.
    const sloganSaisi = reponses.slogan !== undefined ? String(reponses.slogan).trim() : null;
    if (sloganSaisi) maj.slogan = sloganSaisi.slice(0, 160);
    else if (!boutique.slogan) maj.slogan = proposition.slogan;

    if (reponses.sections) {
      const s = reponses.sections;
      maj.vitrineSections = {
        apropos: s.apropos !== false,
        categories: s.categories !== false,
        avis: s.avis !== false,
        contact: s.contact !== false,
      };
    } else {
      maj.vitrineSections = proposition.sections;
    }

    // ── Caisse ────────────────────────────────────────────────────────
    maj.vitrineCommande = reponses.commande !== false;
    maj.vitrinePaiementLivraison = reponses.paiementLivraison !== false;

    // ── Adresse du site ───────────────────────────────────────────────
    if (!boutique.slug) {
      maj.slug = await genererSlugUnique(boutique.nom);
    }

    // ── Publication ───────────────────────────────────────────────────
    maj.vitrineConfiguree = true;
    maj.vitrineActive = reponses.active !== false;
    if (!boutique.vitrineCreeeLe) maj.vitrineCreeeLe = new Date();

    await boutique.update(maj);

    logger.info('[vitrine] site généré', {
      boutiqueId: boutique.id,
      secteur: secteur.cle,
      modele: maj.vitrineModele,
    });

    // Un site sans produit s'affiche, mais il annonce un catalogue à venir :
    // l'application doit pouvoir le dire au vendeur au moment où il découvre
    // son site, pas le laisser le partager pour rien.
    const nombreProduits = await Produit.count({ where: { vendeurId, statut: 'approuve' } });

    const VendeurService = require('../vendeurs/vendeur.service');
    const etat = await VendeurService.maVitrine(vendeurId);
    return { ...etat, nombreProduits, premiereCreation, logoEnregistre };
  }
}

module.exports = AssistantService;
module.exports.SECTEURS = SECTEURS;
