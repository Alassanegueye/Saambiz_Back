#!/usr/bin/env node
/**
 * Réparation des comptes désactivés à tort par l'ancien job d'abonnement.
 *
 * Le job `abonnement.job.js` chargeait `Utilisateur.findAll()` sans filtre de
 * rôle — la variable s'appelait `vendeurs`, mais la requête ramenait tout le
 * monde — puis passait à `statut: 'inactif'` quiconque n'avait pas
 * d'abonnement en cours. Les Admin et les Acheteur n'en ont jamais : chaque
 * nuit à 00h00, tous leurs comptes étaient désactivés, et la connexion était
 * ensuite refusée avec « Votre compte est inactif ».
 *
 * L'étape fautive est supprimée, mais les comptes déjà passés à 'inactif'
 * le restent : ce script les remet à 'actif'.
 *
 * Ne touche QUE les Admin et les Acheteur, qui n'ont jamais d'abonnement et
 * ne pouvaient donc être désactivés que par ce job ou par un administrateur.
 * Les Vendeur sont laissés de côté : un vendeur inactif peut l'être pour une
 * raison légitime (suspension), et rien dans la base ne distingue après coup
 * une suspension d'un passage du cron. Ils sont comptés et listés, pour que
 * tu décides au cas par cas.
 *
 * Usage :
 *   node -r dotenv/config scripts/reactiver-comptes.js              (rapport seul)
 *   node -r dotenv/config scripts/reactiver-comptes.js --appliquer  (écrit)
 */
const { Op } = require('sequelize');
const { sequelize, Utilisateur } = require('../src/models');

const APPLIQUER = process.argv.includes('--appliquer');

async function principal() {
  await sequelize.authenticate();

  const aReparer = await Utilisateur.findAll({
    where: { statut: 'inactif', role: { [Op.in]: ['Admin', 'Acheteur'] } },
    attributes: ['id', 'email', 'role', 'nom', 'prenom'],
    order: [['role', 'ASC'], ['email', 'ASC']],
  });

  const vendeurs = await Utilisateur.count({
    where: { statut: 'inactif', role: 'Vendeur' },
  });

  if (aReparer.length === 0) {
    console.log('Aucun compte Admin ou Acheteur desactive. Rien a reparer.');
  } else {
    console.log(`${aReparer.length} compte(s) Admin/Acheteur desactive(s) :`);
    for (const u of aReparer) {
      console.log(`  - [${u.role}] ${u.email} (${u.prenom} ${u.nom})`);
    }
  }

  if (vendeurs > 0) {
    console.log(
      `\n${vendeurs} compte(s) Vendeur sont aussi inactifs. Ils ne sont PAS`
      + '\ntouches : une suspension legitime ne se distingue plus, en base,'
      + "\nd'un passage du cron. A reprendre a la main depuis le back-office."
    );
  }

  if (!APPLIQUER) {
    console.log(
      '\nRapport seul, aucune ecriture.'
      + '\nRelancer avec --appliquer pour reactiver les comptes listes.'
    );
    return;
  }

  if (aReparer.length === 0) return;

  const [modifies] = await Utilisateur.update(
    { statut: 'actif' },
    { where: { statut: 'inactif', role: { [Op.in]: ['Admin', 'Acheteur'] } } }
  );
  console.log(`\n${modifies} compte(s) remis a 'actif'.`);
}

principal()
  .then(async () => {
    await sequelize.close();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Echec :', err.message);
    try {
      await sequelize.close();
    } catch {
      /* la connexion est peut-etre deja tombee */
    }
    process.exit(1);
  });
