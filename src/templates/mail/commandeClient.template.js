// Emails envoyés au client AU NOM de la boutique : commande reçue, puis
// chaque étape (confirmée, prête, en livraison, livrée, annulée).
// En-tête au logo et au nom de la boutique (voir miseEnPage, option boutique).
const { miseEnPage, salutation, paragraphe, encadre, note, echapper } = require('./miseEnPage');

const ETAPES = {
  recue: {
    objet: 'Commande reçue',
    texte: 'Nous avons bien reçu votre commande. Nous vous recontactons très vite pour la confirmer.',
  },
  confirmee: { objet: 'Commande confirmée', texte: 'Votre commande est confirmée. Nous la préparons.' },
  en_preparation: { objet: 'Commande en préparation', texte: 'Votre commande est en cours de préparation.' },
  prete: { objet: 'Commande prête', texte: 'Votre commande est prête.' },
  en_livraison: { objet: 'Commande en route', texte: 'Votre commande est en cours de livraison.' },
  livree: { objet: 'Commande livrée', texte: 'Votre commande a été livrée. Merci pour votre achat !' },
  annulee: { objet: 'Commande annulée', texte: 'Votre commande a été annulée.' },
};

const montant = (v) => `${Number(v || 0).toLocaleString('fr-FR')} FCFA`;

function commandeClientTemplate({ etape, boutique, nomClient, commande, lignes = [], messagePerso }) {
  const e = ETAPES[etape] || ETAPES.recue;
  const articles = lignes.length
    ? lignes.map((l) => [`${echapper(l.nomProduit)} × ${echapper(l.quantite)}`, montant(l.sousTotal)])
    : [];
  const html = miseEnPage(
    `${salutation(nomClient)}
      ${paragraphe(echapper(messagePerso || e.texte))}
      ${encadre([
        ['Référence', echapper(commande.referenceCommande)],
        ...articles,
        ...(Number(commande.fraisLivraison) > 0 ? [['Livraison', montant(commande.fraisLivraison)]] : []),
        ['Total', montant(commande.montantTotal)],
      ])}
      ${note(`Une question ? Contactez directement ${echapper(boutique.nom)}${boutique.telephone ? ` au ${echapper(boutique.telephone)}` : ''}.`)}`,
    { titre: `${e.objet} — ${boutique.nom}`, apercu: `${e.objet} ${commande.referenceCommande}`, boutique }
  );
  return { objet: `${e.objet} ${commande.referenceCommande} — ${boutique.nom}`, html };
}

module.exports = commandeClientTemplate;
module.exports.ETAPES = ETAPES;
