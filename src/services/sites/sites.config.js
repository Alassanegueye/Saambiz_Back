// services/sites/sites.config.js
//
// Les sites vitrines dont cette API compte la fréquentation. Un site absent
// de cette liste est refusé (404) : on ne remplit pas la base avec n'importe
// quel nom envoyé par un navigateur.
//
//   kodafrik : kodafrik.com — hébergé chez LWS, qui n'exécute plus son PHP.
//              Sa fréquentation, son formulaire de contact et les e-mails du
//              back-office Kodafrik passent par ici.
//   saambiz  : saambiz.com — les pages de présentation de la marketplace (les
//              boutiques, elles, sont comptées par visiteBoutique).

const sansSlashFinal = (u) => String(u || '').replace(/\/+$/, '');

const SITES = Object.freeze({
  kodafrik: Object.freeze({
    id: 'kodafrik',
    nom: 'Kodafrik',
    domaine: 'kodafrik.com',
    // Formulaire de contact et e-mails du back-office.
    messages: true,
    mails: true,
  }),
  saambiz: Object.freeze({
    id: 'saambiz',
    nom: 'SaamBiz',
    domaine: 'saambiz.com',
    messages: false,
    mails: false,
  }),
});

/** Le site s'il est connu, sinon null. */
function siteConnu(id) {
  return Object.prototype.hasOwnProperty.call(SITES, id) ? SITES[id] : null;
}

/** Réglages de Kodafrik, lus à chaque appel (les tests changent l'environnement). */
function reglagesKodafrik() {
  return {
    // Où arrivent les demandes du formulaire.
    contact: process.env.KODAFRIK_CONTACT_EMAIL || 'contact@kodafrik.com',
    // Expéditeur des e-mails. L'ADRESSE doit appartenir à un domaine vérifié
    // chez Resend : par défaut celle de MAIL_FROM, sous le nom « Kodafrik ».
    // Une fois kodafrik.com vérifié chez Resend : KODAFRIK_MAIL_FROM =
    // « Kodafrik <contact@kodafrik.com> ».
    expediteur: process.env.KODAFRIK_MAIL_FROM || '',
    // Le portail du back-office, où l'on se connecte.
    portail: `${sansSlashFinal(process.env.KODAFRIK_PORTAIL || 'https://admin.kodafrik.com')}/`,
    // Les images des e-mails, servies par le site (fichiers statiques : LWS
    // les sert, seul le PHP est bloqué).
    images: sansSlashFinal(process.env.KODAFRIK_MAIL_IMAGES || 'https://kodafrik.com/email'),
  };
}

module.exports = { SITES, siteConnu, reglagesKodafrik };
