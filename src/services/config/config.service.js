const { ConfigApp } = require('../../models');

const PRIX_ABONNEMENT_KEY = 'prix_abonnement';

class ConfigService {

  static async getConfig(cle) {
    return await ConfigApp.findOne({ where: { cle } });
  }

  static async getPrixAbonnement() {
    const config = await ConfigApp.findOne({ where: { cle: PRIX_ABONNEMENT_KEY } });
    if (!config) return 2000;
    return parseInt(config.valeur, 10);
  }

  static async getAllConfigs() {
    return await ConfigApp.findAll({ order: [['createdAt', 'ASC']] });
  }

  static async ajouterConfig({ cle, valeur, description, adminId }) {
    const existe = await ConfigApp.findOne({ where: { cle } });
    if (existe) throw new Error(`La configuration "${cle}" existe déjà. Utilisez la modification.`);
    const config = await ConfigApp.create({ cle, valeur, description, modifiePar: adminId });
    return { message: 'Configuration ajoutée avec succès', config };
  }

  static async modifierConfig({ cle, valeur, description, adminId }) {
    const config = await ConfigApp.findOne({ where: { cle } });
    if (!config) throw new Error(`Configuration "${cle}" introuvable`);
    await config.update({ valeur, description: description ?? config.description, modifiePar: adminId });
    return { message: 'Configuration mise à jour avec succès', config };
  }
}

module.exports = ConfigService;
