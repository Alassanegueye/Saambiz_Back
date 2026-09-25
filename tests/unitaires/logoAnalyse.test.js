/**
 * Analyse du logo — la partie de l'assistant qui décide seule.
 *
 * C'est le code le plus facile à casser sans s'en apercevoir : il ne lève
 * aucune erreur quand il se trompe, il propose simplement une couleur illisible
 * ou rogne un logo rond dans un carré. Les cas ci-dessous sont ceux qui se sont
 * révélés faux à l'essai, et ceux qui comptent en production.
 *
 * Les images sont FACTICES — un bitmap construit à la main, à la forme de
 * celui de Jimp. Deux raisons :
 *
 *   1. Jimp décode ses PNG par import dynamique, ce que Jest ne sait pas faire
 *      sans `--experimental-vm-modules` ; décoder ici testerait la mécanique
 *      de Jest, pas notre logique.
 *   2. Ce qui mérite d'être verrouillé, c'est la DÉCISION — cette forme est-elle
 *      ronde, cette couleur est-elle lisible — pas la lecture d'un fichier PNG,
 *      qui est le métier de Jimp et que le parcours de bout en bout couvre déjà.
 */
const LogoAnalyseService = require('../../src/services/vitrine/logo.analyse.service');
const { contraste } = require('../../src/services/vitrine/logo.analyse.service');

/**
 * Un bitmap RGBA à la forme de celui de Jimp, avec les deux seules méthodes
 * que le service utilise.
 *
 * @param {number} largeur
 * @param {number} hauteur
 * @param {(x:number,y:number) => [number,number,number,number]} peindre
 */
function imageFactice(largeur, hauteur, peindre) {
  const data = Buffer.alloc(largeur * hauteur * 4);

  for (let y = 0; y < hauteur; y++) {
    for (let x = 0; x < largeur; x++) {
      const [r, g, b, a] = peindre(x, y);
      const i = (y * largeur + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
  }

  return {
    bitmap: { width: largeur, height: hauteur, data },
    getPixelIndex(x, y) { return (y * largeur + x) * 4; },
    scan(_x0, _y0, l, h, rappel) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < l; x++) rappel.call(this, x, y, (y * l + x) * 4);
      }
    },
  };
}

const VIDE = [0, 0, 0, 0];
const BLANC = [255, 255, 255, 255];
const VERT = [27, 127, 79, 255];
const ORANGE = [230, 126, 34, 255];
const VIOLET = [107, 78, 255, 255];
const ROSE_PALE = [255, 214, 224, 255];
const GRIS = [154, 154, 154, 255];

const dansDisque = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

/** Reproduit l'enchaînement de `analyser`, sans l'étape de décodage. */
function analyser(image, largeurReelle, hauteurReelle) {
  const { couleurs, aDeLaTransparence } = LogoAnalyseService._extraireCouleurs(image);
  const forme = LogoAnalyseService._detecterForme(
    image, largeurReelle, hauteurReelle, aDeLaTransparence,
  );
  const accent = LogoAnalyseService._choisirAccent(couleurs);

  return {
    couleurs,
    fondTransparent: aDeLaTransparence,
    forme: forme.nom,
    placement: forme.placement,
    conseilForme: forme.conseil,
    accentPropose: accent,
    palette: LogoAnalyseService._composerPalette(accent, couleurs),
    qualite: LogoAnalyseService._jugerQualite(largeurReelle, hauteurReelle),
  };
}

describe('Forme du logo', () => {
  it('reconnaît un logo rond posé sur du transparent', () => {
    const im = imageFactice(200, 200, (x, y) => (dansDisque(x, y, 100, 100, 95) ? VERT : VIDE));
    const a = analyser(im, 400, 400);

    expect(a.forme).toBe('rond');
    expect(a.placement).toBe('pastille-ronde');
    expect(a.fondTransparent).toBe(true);
  });

  it('reconnaît un logo carré plein malgré un motif blanc au centre', () => {
    // Le cas qui tombait en « rond » : le blanc du motif était compté comme du
    // vide, la surface passait sous le seuil, et le logo se retrouvait rogné en
    // pastille alors qu'il remplit son cadre. Le fond se lit désormais aux
    // coins — ici ils sont orange, donc rien n'est du vide.
    const im = imageFactice(200, 200, (x, y) =>
      (x > 55 && x < 145 && y > 80 && y < 120 ? BLANC : ORANGE));
    const a = analyser(im, 500, 500);

    expect(a.forme).toBe('carre');
    expect(a.placement).toBe('tuile-arrondie');
  });

  it('traite le blanc comme un fond quand les BORDS sont blancs', () => {
    // Un logo exporté en JPEG : disque coloré sur fond blanc. Ici le blanc est
    // bien du vide, et la forme doit ressortir ronde.
    const im = imageFactice(200, 200, (x, y) => (dansDisque(x, y, 100, 100, 90) ? VERT : BLANC));
    const a = analyser(im, 400, 400);

    expect(a.fondTransparent).toBe(false);
    expect(a.forme).toBe('rond');
  });

  it('reconnaît un logo bandeau et ne le met pas en pastille', () => {
    const im = imageFactice(200, 49, () => VIOLET);
    const a = analyser(im, 900, 220);

    expect(a.forme).toBe('bandeau');
    expect(a.placement).toBe('entete-pleine-largeur');
    expect(a.conseilForme).toMatch(/nom de votre boutique/i);
  });

  it('laisse en forme libre un dessin qui ne remplit pas son cadre', () => {
    // Un sigle fin et ajouré : le rogner ferait perdre du dessin.
    const im = imageFactice(200, 200, (x, y) => (y > 92 && y < 110 ? VERT : VIDE));
    const a = analyser(im, 300, 300);

    expect(a.forme).toBe('libre');
    expect(a.placement).toBe('libre');
  });
});

describe('Couleurs du logo', () => {
  it('relève la couleur dominante du logo', () => {
    const im = imageFactice(200, 200, (x, y) => (dansDisque(x, y, 100, 100, 95) ? VERT : VIDE));
    const a = analyser(im, 400, 400);

    expect(a.couleurs.length).toBeGreaterThan(0);
    expect(a.couleurs[0].hex).toBe('#1B7F4F');
    expect(a.accentPropose).toBe('#1B7F4F');
  });

  it('assombrit une couleur trop pâle pour rester lisible sur blanc', () => {
    const im = imageFactice(200, 200, () => ROSE_PALE);
    const a = analyser(im, 400, 400);

    // Un accent sert de fond de bouton et de couleur de lien : en dessous de
    // 3:1 sur blanc, le lien devient illisible en plein soleil.
    expect(contraste(a.accentPropose, '#FFFFFF')).toBeGreaterThanOrEqual(3);
  });

  it("conserve la teinte du logo en l'assombrissant", () => {
    const im = imageFactice(200, 200, () => ROSE_PALE);
    const a = analyser(im, 400, 400);

    const n = parseInt(a.accentPropose.slice(1), 16);
    const [r, v, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    // Le rose reste dominé par le rouge : on assombrit, on ne change pas de couleur.
    expect(r).toBeGreaterThan(v);
    expect(r).toBeGreaterThan(b);
  });

  it("retombe sur le bleu SaamBiz quand le logo n'a aucune couleur franche", () => {
    const im = imageFactice(200, 200, () => GRIS);
    const a = analyser(im, 400, 400);

    expect(a.couleurs).toHaveLength(0);
    expect(a.accentPropose).toBe('#0D1B3D');
  });

  it('propose des couleurs qui se distinguent les unes des autres', () => {
    const im = imageFactice(200, 200, (x, y) => (dansDisque(x, y, 100, 100, 95) ? VERT : VIDE));
    const a = analyser(im, 400, 400);

    expect(a.palette.length).toBeGreaterThanOrEqual(3);
    const hexs = a.palette.map((c) => c.hex);
    expect(new Set(hexs).size).toBe(hexs.length);
    // Chaque pastille porte la raison de sa présence : le vendeur doit savoir
    // d'où elle sort avant de la choisir.
    expect(a.palette.every((c) => typeof c.nom === 'string' && c.nom.length > 0)).toBe(true);
  });
});

describe('Qualité du logo', () => {
  it("alerte sur un logo trop petit pour l'en-tête", () => {
    const q = LogoAnalyseService._jugerQualite(80, 80);
    expect(q.niveau).toBe('faible');
    expect(q.message).toMatch(/flou/i);
  });

  it('accepte sans réserve un logo de bonne taille', () => {
    expect(LogoAnalyseService._jugerQualite(600, 600).niveau).toBe('bonne');
  });
});

describe('Tolérance à la panne', () => {
  it("ne casse pas l'assistant sur un fichier illisible", async () => {
    const a = await LogoAnalyseService.analyserOuDefaut(Buffer.from("ceci n'est pas une image"));

    // Valeurs neutres : le vendeur choisira sa couleur à la main plutôt que de
    // se voir refuser la création de son site.
    expect(a.forme).toBe('libre');
    expect(a.accentPropose).toBe('#0D1B3D');
    expect(a.palette.length).toBeGreaterThan(0);
  });

  it('refuse explicitement un fichier vide', async () => {
    await expect(LogoAnalyseService.analyser(Buffer.alloc(0)))
      .rejects.toThrow(/aucun logo/i);
  });
});
