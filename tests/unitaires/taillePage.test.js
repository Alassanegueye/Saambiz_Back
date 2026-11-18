/**
 * Dix par page, partout, et une seule fois.
 *
 * La taille de page a longtemps ete ecrite trois fois : quinze dans
 * acheteurs.service, vingt dans vendeur.service et vingt dans
 * demandeRetour.service, chacune avec sa propre copie du calcul d'offset.
 * Changer la regle en changeait un tiers. Deux de ces copies prenaient en
 * plus le `limit` de la requete sans borne haute, ce qui rendait
 * `?limit=100000` suffisant pour faire charger une table entiere.
 *
 * Ce fichier tient les deux bouts : le comportement du helper partage, et
 * l'absence de toute taille de page ecrite en dur ailleurs.
 */
const fs = require('fs');
const path = require('path');
const { paginate, metaPagination, LIMITE_DEFAUT, LIMITE_MAX } = require('../../src/utils/paginate');

const RACINE = path.join(__dirname, '..', '..', 'src');

describe('Le helper de pagination', () => {
  test('dix par page quand la requete ne demande rien', () => {
    expect(LIMITE_DEFAUT).toBe(10);
    expect(paginate()).toEqual({ page: 1, limit: 10, offset: 0 });
  });

  test('l offset suit la page demandee', () => {
    expect(paginate(3)).toEqual({ page: 3, limit: 10, offset: 20 });
  });

  test('une page absurde revient a la premiere', () => {
    for (const valeur of [0, -4, 'abc', null, undefined, '']) {
      expect(paginate(valeur).page).toBe(1);
    }
  });

  test('un limit demesure est plafonne', () => {
    // C'est le point important : sans cette borne, une seule requete fait
    // charger toute une table, la serialiser et l'envoyer.
    expect(paginate(1, 100000).limit).toBe(LIMITE_MAX);
    expect(paginate(1, '999').limit).toBe(LIMITE_MAX);
  });

  test('un limit nul ou negatif ne vide pas la page', () => {
    for (const valeur of [0, -1, 'zero']) {
      expect(paginate(1, valeur).limit).toBeGreaterThan(0);
    }
  });

  test('les metadonnees annoncent au moins une page', () => {
    // Une liste vide a une page, vide : zero page ferait disparaitre la
    // barre « Precedent / Suivant » du mobile sur un etat legitime.
    expect(metaPagination(0, 1, 10)).toEqual({ total: 0, page: 1, limit: 10, pages: 1 });
    expect(metaPagination(25, 2, 10).pages).toBe(3);
  });
});

describe('Aucun service ne redefinit sa taille de page', () => {
  /** Tous les fichiers de service. */
  function services(dossier = path.join(RACINE, 'services')) {
    return fs.readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
      const complet = path.join(dossier, e.name);
      if (e.isDirectory()) return services(complet);
      return e.name.endsWith('.service.js') ? [complet] : [];
    });
  }

  test('pas de taille de page ecrite en dur', () => {
    const fautifs = [];
    for (const fichier of services()) {
      const source = fs.readFileSync(fichier, 'utf8');
      // `const DEFAULT_PAGE_SIZE = 20;` ou `const LIMIT = 15;` : une valeur
      // litterale. Reprendre LIMITE_DEFAUT du helper reste permis.
      const enDur = /const\s+(DEFAULT_PAGE_SIZE|LIMIT|LIMITE_DEFAUT|PAGE_SIZE|TAILLE_PAGE)\s*=\s*\d+\s*;/.exec(source);
      if (enDur) fautifs.push(`${path.relative(RACINE, fichier)} : ${enDur[0]}`);
    }
    expect(fautifs).toEqual([]);
  });

  test('pas de copie locale du calcul d offset', () => {
    // Une copie locale de `paginate` n'a pas de borne haute : c'est par la
    // que `?limit=100000` passait.
    const fautifs = services().filter((fichier) => {
      const source = fs.readFileSync(fichier, 'utf8');
      return /^(function|const)\s+paginate\s*[=(]/m.test(source);
    });
    expect(fautifs.map((f) => path.relative(RACINE, f))).toEqual([]);
  });
});
