const { QuestionFrequente, ConfigApp } = require('../../models');
const { BadRequestError, NotFoundError } = require('../../errors/AppError');
const { estEmailValide } = require('../../utils/email');
const { normaliserTelephone, erreurTelephone } = require('../../utils/telephone');

/**
 * Centre d'aide de l'application : questions fréquentes et coordonnées du
 * service client. Tout se modifie depuis le dashboard admin ; l'application
 * lit le résultat sur GET /centre-aide.
 */

// Clés de config_app → champ exposé.
const CLES_CONTACT = {
  whatsapp: 'contact_whatsapp',
  email: 'contact_email',
  telephone: 'contact_telephone',
};

// Valeurs servies tant que l'admin n'a rien enregistré.
const CONTACTS_DEFAUT = {
  whatsapp: '+221775929390',
  email: 'contact@saambiz.com',
  telephone: '+221775929390',
};

const texte = (v, max) => String(v ?? '').trim().slice(0, max);

class CentreAideService {

  static async contacts() {
    const lignes = await ConfigApp.findAll({ where: { cle: Object.values(CLES_CONTACT) } });
    const parCle = Object.fromEntries(lignes.map((l) => [l.cle, l.valeur]));
    return Object.fromEntries(Object.entries(CLES_CONTACT)
      .map(([champ, cle]) => [champ, parCle[cle] || CONTACTS_DEFAUT[champ]]));
  }

  static async modifierContacts(data = {}, adminId = null) {
    const valeurs = {};
    if (data.email !== undefined) {
      const email = texte(data.email, 254).toLowerCase();
      if (!estEmailValide(email)) throw new BadRequestError('Adresse e-mail invalide.');
      valeurs.email = email;
    }
    for (const champ of ['whatsapp', 'telephone']) {
      if (data[champ] === undefined) continue;
      const erreur = erreurTelephone(data[champ]);
      if (erreur) throw new BadRequestError(`${champ === 'whatsapp' ? 'WhatsApp' : 'Téléphone'} : ${erreur}`);
      valeurs[champ] = normaliserTelephone(data[champ]);
    }
    for (const [champ, valeur] of Object.entries(valeurs)) {
      const cle = CLES_CONTACT[champ];
      const [ligne, cree] = await ConfigApp.findOrCreate({
        where: { cle },
        defaults: { cle, valeur, description: `Contact du service client (${champ})`, modifiePar: adminId },
      });
      if (!cree) await ligne.update({ valeur, modifiePar: adminId });
    }
    return CentreAideService.contacts();
  }

  /** Questions, dans l'ordre. `toutes` : y compris celles masquées (admin). */
  static async questions({ toutes = false } = {}) {
    return QuestionFrequente.findAll({
      where: toutes ? {} : { active: true },
      order: [['ordre', 'ASC'], ['createdAt', 'ASC']],
    });
  }

  static _valider(data, { partiel = false } = {}) {
    const champs = {};
    if (!partiel || data.question !== undefined) {
      champs.question = texte(data.question, 200);
      if (!champs.question) throw new BadRequestError('La question est requise.');
    }
    if (!partiel || data.reponse !== undefined) {
      champs.reponse = texte(data.reponse, 3000);
      if (!champs.reponse) throw new BadRequestError('La réponse est requise.');
    }
    if (data.active !== undefined) champs.active = data.active === true || data.active === 'true';
    if (data.ordre !== undefined) {
      const ordre = Number(data.ordre);
      if (!Number.isInteger(ordre)) throw new BadRequestError('Ordre invalide.');
      champs.ordre = ordre;
    }
    return champs;
  }

  static async ajouterQuestion(data = {}) {
    const champs = CentreAideService._valider(data);
    if (champs.ordre === undefined) {
      const dernier = await QuestionFrequente.max('ordre');
      champs.ordre = (Number.isFinite(dernier) ? dernier : 0) + 1;
    }
    return QuestionFrequente.create(champs);
  }

  static async modifierQuestion(id, data = {}) {
    const q = await QuestionFrequente.findByPk(id);
    if (!q) throw new NotFoundError('Question introuvable.');
    await q.update(CentreAideService._valider(data, { partiel: true }));
    return q;
  }

  static async supprimerQuestion(id) {
    const n = await QuestionFrequente.destroy({ where: { id } });
    if (!n) throw new NotFoundError('Question introuvable.');
  }

  /** Nouvel ordre : la liste des identifiants, de la première à la dernière. */
  static async ordonner(ids = []) {
    if (!Array.isArray(ids)) throw new BadRequestError('Liste attendue.');
    await Promise.all(ids.map((id, i) => QuestionFrequente.update({ ordre: i + 1 }, { where: { id } })));
    return CentreAideService.questions({ toutes: true });
  }

  /** Ce que lit l'application. */
  static async publique() {
    const [contacts, questions] = await Promise.all([
      CentreAideService.contacts(),
      CentreAideService.questions(),
    ]);
    return {
      contacts,
      questions: questions.map((q) => ({ id: q.id, question: q.question, reponse: q.reponse })),
    };
  }
}

module.exports = CentreAideService;
module.exports.CONTACTS_DEFAUT = CONTACTS_DEFAUT;
