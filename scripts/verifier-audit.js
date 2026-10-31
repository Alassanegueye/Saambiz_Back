#!/usr/bin/env node
/**
 * Contrôle des vulnérabilités des dépendances de PRODUCTION, avec exceptions
 * documentées.
 *
 * Pourquoi ce script plutôt que `npm audit --audit-level=moderate` seul :
 * certaines vulnérabilités n'ont aucun correctif applicable. Les laisser faire
 * échouer le job en permanence apprend à l'équipe à ignorer le voyant rouge —
 * et le jour où une faille réellement corrigeable apparaît, personne ne la
 * voit. Relever `--audit-level` à `critical` aurait l'effet inverse : masquer
 * sans trace vingt-neuf alertes « high ».
 *
 * Ici, chaque exception porte un nom, une raison et une date de revue. Toute
 * vulnérabilité qui ne vient PAS d'un paquet accepté fait échouer le contrôle.
 *
 * Usage : node scripts/verifier-audit.js
 */
const { execFileSync } = require('child_process');

/**
 * Paquets dont les vulnérabilités sont acceptées, avec la raison.
 *
 * À relire à chaque date indiquée : une exception sans échéance devient
 * permanente par oubli.
 */
const ACCEPTEES = {
  zod: {
    raison: [
      "Tiré uniquement par jimp (analyse du logo dans l'assistant de vitrine).",
      "L'avis demande zod >= 4.6.6 ; jimp 1.6.1 — la dernière version publiée —",
      'déclare zod ^3.23.8. Forcer la 4.x casserait jimp, et `npm audit fix --force`',
      'propose de redescendre à jimp 0.22, deux majeures en arrière, avec une API',
      'différente. Exposition réelle : zod ne valide ici que les options que le',
      'code passe lui-même à jimp (dimensions de redimensionnement), jamais une',
      "donnée venant d'un utilisateur.",
    ].join(' '),
    revoirApres: '2026-12-31',
  },
};

function auditer() {
  // `npm audit` sort en code 1 dès qu'il trouve quelque chose : on récupère
  // donc la sortie même en cas d'échec, c'est le JSON qui nous intéresse.
  try {
    return JSON.parse(
      execFileSync('npm', ['audit', '--omit=dev', '--json'], {
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
      }),
    );
  } catch (err) {
    if (err.stdout) return JSON.parse(err.stdout);
    throw err;
  }
}

const rapport = auditer();
const vulnerabilites = rapport.vulnerabilities || {};

// Dans le rapport de npm, `via` contient soit un OBJET — l'avis lui-même, qui
// nomme le paquet réellement en cause — soit une CHAÎNE, qui ne fait que
// propager (« je suis vulnérable parce que je dépends de celui-là »).
//
// On raisonne donc sur les avis : une seule faille dans zod fait apparaître
// vingt-neuf paquets dans le rapport, et les énumérer n'apprend rien.
const sources = new Map();

function noter(nom, severite) {
  if (!sources.has(nom)) sources.set(nom, new Set());
  sources.get(nom).add(severite);
}

for (const [nom, info] of Object.entries(vulnerabilites)) {
  const avis = (info.via || []).filter((v) => typeof v === 'object');
  for (const a of avis) noter(a.name, a.severity || info.severity);

  // Défensif : un paquet vulnérable sans aucun avis et dont les renvois ne
  // figurent pas dans le rapport est sa propre source. Sans ce filet, une
  // forme de rapport inattendue passerait inaperçue.
  if (avis.length === 0) {
    const renvoisConnus = (info.via || []).some((v) => typeof v === 'string' && vulnerabilites[v]);
    if (!renvoisConnus) noter(nom, info.severity);
  }
}

const aujourdhui = new Date().toISOString().slice(0, 10);
const bloquantes = [];

console.log(`${Object.keys(vulnerabilites).length} paquet(s) de production touché(s), `
  + `${sources.size} cause(s) réelle(s).`);
console.log('');

for (const [source, severites] of [...sources.entries()].sort()) {
  const niveaux = [...severites].join(', ');
  const exception = ACCEPTEES[source];

  if (!exception) {
    bloquantes.push({ source, niveaux });
    continue;
  }

  console.log(`ACCEPTÉE  ${source} (${niveaux})`);
  console.log(`          ${exception.raison}`);
  if (exception.revoirApres < aujourdhui) {
    console.log(`          ⚠ À REVOIR : échéance dépassée (${exception.revoirApres}).`);
  } else {
    console.log(`          À revoir après le ${exception.revoirApres}.`);
  }
  console.log('');
}

if (bloquantes.length === 0) {
  console.log('Aucune vulnérabilité hors exceptions documentées.');
  process.exit(0);
}

for (const b of bloquantes) {
  console.log(`::error::${b.source} (${b.niveaux}) — vulnérabilité sans exception documentée.`);
}
console.log('');
console.log("Corriger avec `npm audit fix`, ou — si aucun correctif n'existe —");
console.log('ajouter une exception motivée et datée dans scripts/verifier-audit.js.');
process.exit(1);
