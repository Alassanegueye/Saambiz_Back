/**
 * Mise en forme des noms, appliquée par les modèles à chaque écriture :
 * peu importe comment la personne a tapé, la base reçoit toujours
 *   - un prénom avec une majuscule à chaque mot :  « awa fatou »  → « Awa Fatou »,
 *                                                  « jean-pierre » → « Jean-Pierre » ;
 *   - un nom de famille tout en majuscules :      « diop »        → « DIOP » ;
 *   - un nom de boutique avec une majuscule initiale, le reste tel quel
 *     (« chez awa » → « Chez awa », « SaamBiz Store » reste intact).
 * Les espaces en trop sont retirés. Une valeur vide ou non textuelle passe
 * telle quelle : les validations du modèle s'en chargent.
 */

const nettoyer = (v) => v.replace(/\s+/g, ' ').trim();

const majusculeInitiale = (mot) =>
  mot ? mot.charAt(0).toLocaleUpperCase('fr-FR') + mot.slice(1) : mot;

function formaterPrenom(valeur) {
  if (typeof valeur !== 'string') return valeur;
  const v = nettoyer(valeur).toLocaleLowerCase('fr-FR');
  // Majuscule après chaque espace et chaque trait d'union.
  return v.split(' ').map((mot) => mot.split('-').map(majusculeInitiale).join('-')).join(' ');
}

function formaterNom(valeur) {
  if (typeof valeur !== 'string') return valeur;
  return nettoyer(valeur).toLocaleUpperCase('fr-FR');
}

function formaterNomBoutique(valeur) {
  if (typeof valeur !== 'string') return valeur;
  return majusculeInitiale(nettoyer(valeur));
}

/**
 * Branche la mise en forme sur un modèle : setters (création, instance.update,
 * instance.save) et crochet `beforeBulkUpdate` (Model.update en masse, qui
 * ne passe pas toujours par les setters).
 * @param {object} Modele modèle Sequelize
 * @param {Record<string, Function>} champs { attribut: fonctionDeFormatage }
 */
function appliquerFormats(Modele, champs) {
  const formaterInstance = (instance) => {
    for (const [champ, f] of Object.entries(champs)) {
      if (instance.changed(champ)) instance.setDataValue(champ, f(instance.getDataValue(champ)));
    }
  };
  // Avant la validation (valeurs déjà propres pour les contrôles de forme)
  // et avant l'écriture (y compris quand la validation est désactivée).
  Modele.addHook('beforeValidate', formaterInstance);
  Modele.addHook('beforeSave', formaterInstance);
  Modele.addHook('beforeBulkCreate', (instances) => instances.forEach(formaterInstance));
  Modele.addHook('beforeBulkUpdate', (options) => {
    for (const [champ, f] of Object.entries(champs)) {
      if (options.attributes && options.attributes[champ] !== undefined) {
        options.attributes[champ] = f(options.attributes[champ]);
      }
    }
  });
}

module.exports = { formaterPrenom, formaterNom, formaterNomBoutique, appliquerFormats };
