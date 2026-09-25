// services/vitrine/logo.analyse.service.js
//
// Lit le logo d'un vendeur et en déduit ce qu'il faut pour habiller son site :
// ses couleurs, sa forme, et l'endroit où le poser.
//
// Pourquoi le faire côté serveur plutôt que dans l'application mobile : le
// même logo doit donner le même résultat que le vendeur passe par son
// téléphone ou par son navigateur, et la logique doit pouvoir être corrigée
// sans attendre qu'un magasin d'applications valide une mise à jour.
//
// L'analyse ne décide de rien. Elle PROPOSE : le vendeur voit les couleurs
// trouvées, la forme détectée, et garde la main sur tout. Un logo mal cadré ou
// une photo de devanture prise à la va-vite ne doit pas enfermer une boutique
// dans une couleur qu'elle n'a pas choisie.

const { Jimp } = require('jimp');
const { BadRequestError } = require('../../errors/AppError');
const logger = require('../../utils/logger');

// Au-delà, on réduit avant d'analyser : un logo de 4000 px n'apprend rien de
// plus qu'un de 200 px sur ses couleurs, et coûte cent fois plus cher à lire.
const TAILLE_ANALYSE = 200;

// Un pixel dont l'alpha est en dessous ne compte pas : c'est du vide, pas une
// couleur du logo.
const ALPHA_MINIMUM = 40;

// ═══════════════════════════════════════════════════════════════════════
//  COULEURS
// ═══════════════════════════════════════════════════════════════════════

/** RVB → TSL, en degrés / pourcentages. */
function versTsl(r, g, b) {
  const rn = r / 255, vn = g / 255, bn = b / 255;
  const max = Math.max(rn, vn, bn);
  const min = Math.min(rn, vn, bn);
  const delta = max - min;
  const l = (max + min) / 2;

  if (delta === 0) return { t: 0, s: 0, l };

  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let t;
  if (max === rn) t = ((vn - bn) / delta) % 6;
  else if (max === vn) t = (bn - rn) / delta + 2;
  else t = (rn - vn) / delta + 4;

  return { t: (t * 60 + 360) % 360, s, l };
}

/** TSL → #RRGGBB. */
function versHex({ t, s, l }) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((t / 60) % 2) - 1));
  const m = l - c / 2;

  const [r, v, b] =
      t < 60  ? [c, x, 0]
    : t < 120 ? [x, c, 0]
    : t < 180 ? [0, c, x]
    : t < 240 ? [0, x, c]
    : t < 300 ? [x, 0, c]
    :           [c, 0, x];

  const composante = (n) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${composante(r)}${composante(v)}${composante(b)}`.toUpperCase();
}

/** Luminance relative (WCAG) — sert à juger la lisibilité, pas l'esthétique. */
function luminance(r, g, b) {
  const c = [r, g, b].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function hexVersRgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Contraste WCAG entre deux couleurs, de 1 (identiques) à 21 (noir/blanc). */
function contraste(hexA, hexB) {
  const a = hexVersRgb(hexA);
  const b = hexVersRgb(hexB);
  const la = luminance(a.r, a.g, a.b);
  const lb = luminance(b.r, b.g, b.b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ═══════════════════════════════════════════════════════════════════════
//  ANALYSE
// ═══════════════════════════════════════════════════════════════════════

class LogoAnalyseService {

  /**
   * Analyse un logo et propose de quoi habiller le site.
   *
   * @param {Buffer} buffer  Le fichier téléversé.
   * @returns {Promise<object>} couleurs, forme, accent proposé, palette.
   */
  static async analyser(buffer) {
    if (!buffer || !buffer.length) {
      throw new BadRequestError('Aucun logo à analyser.');
    }

    let image;
    try {
      image = await Jimp.read(buffer);
    } catch {
      throw new BadRequestError("Ce fichier n'est pas une image lisible. Utilisez un PNG ou un JPEG.");
    }

    const largeur = image.bitmap.width;
    const hauteur = image.bitmap.height;

    // On travaille sur une copie réduite : même information, cent fois moins
    // de pixels à parcourir.
    const petite = image.clone();
    if (Math.max(largeur, hauteur) > TAILLE_ANALYSE) {
      petite.scaleToFit({ w: TAILLE_ANALYSE, h: TAILLE_ANALYSE });
    }

    const { couleurs, aDeLaTransparence } = LogoAnalyseService._extraireCouleurs(petite);
    const forme = LogoAnalyseService._detecterForme(petite, largeur, hauteur, aDeLaTransparence);
    const accent = LogoAnalyseService._choisirAccent(couleurs);
    const palette = LogoAnalyseService._composerPalette(accent, couleurs);

    return {
      dimensions: { largeur, hauteur, ratio: Math.round((largeur / hauteur) * 100) / 100 },
      fondTransparent: aDeLaTransparence,
      forme: forme.nom,
      placement: forme.placement,
      conseilForme: forme.conseil,
      couleurs,
      accentPropose: accent,
      palette,
      // Un logo minuscule remonte flou dès qu'on l'agrandit dans l'en-tête.
      qualite: LogoAnalyseService._jugerQualite(largeur, hauteur),
    };
  }

  /**
   * Les couleurs réellement portées par le logo, les plus présentes d'abord.
   *
   * Les pixels sont regroupés par paquets de 24 niveaux : sans ce
   * regroupement, un aplat légèrement dégradé compte pour deux cents couleurs
   * différentes et aucune ne ressort. Les gris, les quasi-blancs et les
   * quasi-noirs sont écartés du décompte : ce sont des fonds et des contours,
   * pas l'identité de la marque — mais ils restent notés à part, un logo
   * strictement noir et blanc devant rester analysable.
   */
  static _extraireCouleurs(image) {
    const paquets = new Map();
    let aDeLaTransparence = false;
    let pixelsUtiles = 0;

    image.scan(0, 0, image.bitmap.width, image.bitmap.height, function (x, y, idx) {
      const r = this.bitmap.data[idx];
      const g = this.bitmap.data[idx + 1];
      const b = this.bitmap.data[idx + 2];
      const a = this.bitmap.data[idx + 3];

      if (a < ALPHA_MINIMUM) { aDeLaTransparence = true; return; }
      pixelsUtiles++;

      const { s, l } = versTsl(r, g, b);
      // Trop pâle, trop sombre ou trop gris : ce n'est pas une couleur de marque.
      if (l > 0.94 || l < 0.06 || s < 0.12) return;

      const cle = `${Math.round(r / 24)},${Math.round(g / 24)},${Math.round(b / 24)}`;
      const paquet = paquets.get(cle);
      if (paquet) {
        paquet.n++; paquet.r += r; paquet.g += g; paquet.b += b;
      } else {
        paquets.set(cle, { n: 1, r, g, b });
      }
    });

    const total = pixelsUtiles || 1;
    const couleurs = [...paquets.values()]
      .map((p) => {
        const r = Math.round(p.r / p.n);
        const g = Math.round(p.g / p.n);
        const b = Math.round(p.b / p.n);
        const { t, s, l } = versTsl(r, g, b);
        return {
          hex: versHex({ t, s, l }),
          part: Math.round((p.n / total) * 1000) / 10,
          saturation: Math.round(s * 100),
          clarte: Math.round(l * 100),
          _n: p.n,
        };
      })
      // Une couleur rare mais franche vaut mieux qu'un beige omniprésent :
      // le poids mêle la surface occupée et la vivacité.
      .sort((a, b) => (b._n * (0.5 + b.saturation / 100)) - (a._n * (0.5 + a.saturation / 100)))
      .slice(0, 5)
      .map(({ _n, ...reste }) => reste);

    return { couleurs, aDeLaTransparence };
  }

  /**
   * Rond, carré, ou bandeau — et où poser le logo en conséquence.
   *
   * Le taux de remplissage tranche entre rond et carré : un disque occupe
   * environ 78 % de son cadre, un carré la totalité. En dessous de 60 %, la
   * marque est un dessin libre — un sigle, une silhouette — qu'on laisse
   * respirer sans le rogner.
   */
  static _detecterForme(image, largeurReelle, hauteurReelle, aDeLaTransparence) {
    const ratio = largeurReelle / hauteurReelle;

    // Nettement plus large que haut : c'est un logo avec le nom écrit dedans.
    // L'afficher dans une pastille le rendrait illisible.
    if (ratio >= 2.2) {
      return {
        nom: 'bandeau',
        placement: 'entete-pleine-largeur',
        conseil: "Votre logo contient déjà le nom de votre boutique : il s'affiche en entier dans l'en-tête, sans le répéter à côté.",
      };
    }

    const l = image.bitmap.width;
    const h = image.bitmap.height;

    // Ce qui tient lieu de fond se lit AUX COINS, pas au milieu.
    //
    // Sans ce contrôle, tout pixel blanc était compté comme du vide : un logo
    // carré plein portant un motif blanc en son centre voyait ce motif exclu
    // de sa surface, tombait sous le seuil, et se retrouvait classé « rond ».
    // Un logo exporté en JPEG a bien un fond blanc — mais on ne peut le
    // déduire que si ses BORDS sont blancs.
    const coinsBlancs = LogoAnalyseService._coinsSontBlancs(image);

    let occupes = 0;
    image.scan(0, 0, l, h, function (x, y, idx) {
      const a = this.bitmap.data[idx + 3];
      if (a < ALPHA_MINIMUM) return;
      if (!aDeLaTransparence && coinsBlancs) {
        const r = this.bitmap.data[idx];
        const g = this.bitmap.data[idx + 1];
        const b = this.bitmap.data[idx + 2];
        if (r > 242 && g > 242 && b > 242) return;
      }
      occupes++;
    });

    const remplissage = occupes / (l * h);
    const presqueCarre = ratio > 0.8 && ratio < 1.25;

    if (presqueCarre && remplissage > 0.88) {
      return {
        nom: 'carre',
        placement: 'tuile-arrondie',
        conseil: 'Votre logo remplit son cadre : il est posé dans une tuile aux angles arrondis.',
      };
    }

    if (presqueCarre && remplissage > 0.58) {
      return {
        nom: 'rond',
        placement: 'pastille-ronde',
        conseil: 'Votre logo est rond : il est affiché en pastille, comme une photo de profil.',
      };
    }

    return {
      nom: 'libre',
      placement: 'libre',
      conseil: "Votre logo a une forme libre : il s'affiche tel quel, sans cadre ni rognage.",
    };
  }

  /**
   * Les quatre coins de l'image sont-ils blancs ?
   *
   * C'est le seul indice fiable qu'un fichier sans transparence a été exporté
   * sur un fond blanc. On échantillonne un petit carré à chaque coin plutôt
   * qu'un pixel unique : un pixel isolé peut être un artefact de compression.
   */
  static _coinsSontBlancs(image) {
    const l = image.bitmap.width;
    const h = image.bitmap.height;
    const cote = Math.max(2, Math.round(Math.min(l, h) * 0.06));

    const coins = [
      [0, 0],
      [l - cote, 0],
      [0, h - cote],
      [l - cote, h - cote],
    ];

    for (const [ox, oy] of coins) {
      let somme = 0;
      let n = 0;
      for (let y = oy; y < oy + cote; y++) {
        for (let x = ox; x < ox + cote; x++) {
          const idx = image.getPixelIndex(x, y);
          somme += image.bitmap.data[idx] + image.bitmap.data[idx + 1] + image.bitmap.data[idx + 2];
          n += 3;
        }
      }
      if (somme / n < 238) return false;
    }
    return true;
  }

  /**
   * La couleur d'accent proposée.
   *
   * Deux exigences que le vendeur ne formulera jamais mais remarquera tout de
   * suite : la couleur doit être celle de son logo, et le site doit rester
   * lisible. Une couleur trop pâle est donc assombrie jusqu'à tenir le
   * contraste d'un texte sur fond blanc — on garde sa teinte, pas sa fadeur.
   */
  static _choisirAccent(couleurs) {
    if (!couleurs.length) return '#0D1B3D'; // logo sans couleur : bleu SaamBiz

    const premiere = couleurs[0];
    let { t, s, l } = versTsl(...Object.values(hexVersRgb(premiere.hex)));

    // Un accent sert de fond de bouton et de couleur de lien. En dessous de
    // 3:1 sur blanc, le lien devient illisible ; on descend la clarté jusqu'à
    // y arriver, sans jamais virer au noir.
    let hex = versHex({ t, s, l });
    let garde = 0;
    while (contraste(hex, '#FFFFFF') < 3.2 && l > 0.18 && garde++ < 24) {
      l -= 0.03;
      hex = versHex({ t, s, l });
    }

    // Une couleur délavée donne un site terne : on relève un peu la
    // saturation quand le logo est très pâle.
    if (s < 0.25) {
      s = Math.min(0.45, s + 0.18);
      hex = versHex({ t, s, l });
    }

    return hex;
  }

  /**
   * Quatre couleurs proposées au choix, toutes tirées du logo ou de sa teinte.
   *
   * Le vendeur n'aura ni le goût ni l'envie de composer une palette. Il choisit
   * une pastille parmi celles qui vont avec son logo — et le site dérive tout
   * le reste. Les propositions ne sont jamais indiscernables entre elles :
   * offrir quatre nuances du même bleu ne serait pas un choix.
   */
  static _composerPalette(accent, couleurs) {
    const palette = [{ hex: accent, nom: 'Couleur de votre logo' }];

    // Les autres couleurs franches du logo, si elles se distinguent assez.
    for (const c of couleurs.slice(1)) {
      if (palette.length >= 3) break;
      if (c.saturation < 18) continue;
      const distincte = palette.every((p) => contraste(p.hex, c.hex) > 1.25);
      if (distincte) palette.push({ hex: c.hex, nom: 'Autre couleur de votre logo' });
    }

    // Complétée par des harmonies calculées : voisine (douce) et opposée
    // (contrastée). Elles portent la même teinte de base, donc elles vont
    // ensemble sans avoir été choisies à la main.
    const { t, s, l } = versTsl(...Object.values(hexVersRgb(accent)));
    const harmonies = [
      { hex: versHex({ t: (t + 32) % 360, s: Math.min(0.8, s + 0.05), l }), nom: 'Nuance voisine' },
      { hex: versHex({ t: (t + 180) % 360, s: Math.min(0.75, s), l }), nom: 'Couleur opposée' },
      { hex: '#0D1B3D', nom: 'Bleu SaamBiz' },
    ];
    for (const h of harmonies) {
      if (palette.length >= 5) break;
      if (palette.every((p) => p.hex !== h.hex)) palette.push(h);
    }

    return palette;
  }

  /** Un logo trop petit remonte flou dès qu'on l'agrandit dans l'en-tête. */
  static _jugerQualite(largeur, hauteur) {
    const cote = Math.min(largeur, hauteur);
    if (cote < 120) {
      return {
        niveau: 'faible',
        message: 'Votre logo est petit : il risque d\'être flou sur votre site. Un fichier d\'au moins 400 pixels de côté donnera un bien meilleur rendu.',
      };
    }
    if (cote < 250) {
      return {
        niveau: 'correct',
        message: 'Votre logo conviendra. Un fichier plus grand serait encore plus net sur les écrans récents.',
      };
    }
    return { niveau: 'bonne', message: 'Votre logo est de bonne qualité.' };
  }

  /**
   * Analyse tolérante à la panne.
   *
   * L'assistant de création ne doit jamais s'arrêter parce qu'un logo est
   * dans un format exotique : on retombe sur des valeurs neutres et le
   * vendeur choisit sa couleur à la main.
   */
  static async analyserOuDefaut(buffer) {
    try {
      return await LogoAnalyseService.analyser(buffer);
    } catch (err) {
      logger.warn('[vitrine] logo non analysable', { message: err.message });
      return {
        dimensions: null,
        fondTransparent: false,
        forme: 'libre',
        placement: 'libre',
        conseilForme: null,
        couleurs: [],
        accentPropose: '#0D1B3D',
        palette: [
          { hex: '#0D1B3D', nom: 'Bleu SaamBiz' },
          { hex: '#F2B705', nom: 'Or SaamBiz' },
          { hex: '#1B7F4F', nom: 'Vert' },
          { hex: '#B3261E', nom: 'Rouge' },
        ],
        qualite: { niveau: 'inconnue', message: null },
      };
    }
  }
}

module.exports = LogoAnalyseService;
module.exports.contraste = contraste;
module.exports.versTsl = versTsl;
module.exports.versHex = versHex;
