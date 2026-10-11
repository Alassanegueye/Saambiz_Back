const { ConfigApp } = require('../../models');
const { ConflictError, NotFoundError } = require('../../errors/AppError');

const PRIX_ABONNEMENT_KEY = 'prix_abonnement';

// ─────────────────────────────────────────────────────────────────────────────
//  Cache mémoire des réglages.
//
//  Ces valeurs sont lues à chaque ouverture de l'application mobile
//  (`/app/config`), à chaque commande (`frais_livraison`) et à chaque paiement
//  d'abonnement, alors qu'elles changent quelques fois par an, depuis le
//  dashboard. Une requête SQL par lecture, c'était autant d'aller-retours
//  vers la base pour une réponse déjà connue.
//
//  Durée courte (60 s) plutôt qu'une invalidation parfaite : avec plusieurs
//  instances (PM2 cluster, plusieurs conteneurs), seule l'instance qui reçoit
//  la modification vide son cache. Les autres s'alignent au plus tard une
//  minute après — acceptable pour un prix ou un numéro de version minimale.
//
//  On met aussi en cache l'ABSENCE d'une clé (valeur `null`) : sinon une clé
//  jamais créée, comme `maintenance` sur une base neuve, reviendrait
//  interroger la base à chaque appel.
// ─────────────────────────────────────────────────────────────────────────────
const DUREE_CACHE_MS = Number(process.env.CONFIG_CACHE_TTL_MS) || 60 * 1000;
const _cache = new Map(); // cle → { valeur: ConfigApp|null, expireA: number }

function _lireCache(cle) {
  const entree = _cache.get(cle);
  if (!entree) return undefined;
  if (Date.now() >= entree.expireA) { _cache.delete(cle); return undefined; }
  return entree.valeur;
}

function _ecrireCache(cle, valeur) {
  _cache.set(cle, { valeur, expireA: Date.now() + DUREE_CACHE_MS });
}

class ConfigService {

  static async getConfig(cle) {
    const enCache = _lireCache(cle);
    if (enCache !== undefined) return enCache;
    const config = await ConfigApp.findOne({ where: { cle } });
    _ecrireCache(cle, config);
    return config;
  }

  static async getPrixAbonnement() {
    const config = await ConfigService.getConfig(PRIX_ABONNEMENT_KEY);
    if (!config) return 2000;
    return parseInt(config.valeur, 10);
  }

  /**
   * Réglages lus par l'application mobile au démarrage : version minimale
   * par plateforme et mode maintenance. Les trois lectures passent par le
   * cache, d'où une réponse sans requête SQL dans le cas courant.
   */
  static async getConfigApplicationMobile() {
    const [minAndroid, minIos, maintenance] = await Promise.all([
      ConfigService.getConfig('min_version_android').catch(() => null),
      ConfigService.getConfig('min_version_ios').catch(() => null),
      ConfigService.getConfig('maintenance').catch(() => null),
    ]);
    return {
      minVersionAndroid: minAndroid?.valeur || '1.0.0',
      minVersionIos: minIos?.valeur || '1.0.0',
      maintenance: maintenance?.valeur === 'true' || maintenance?.valeur === true,
      message: maintenance?.description || null,
    };
  }

  static async getAllConfigs() {
    // Écran d'administration : toujours la base, jamais le cache — l'admin
    // doit voir l'état réel juste après sa modification.
    return await ConfigApp.findAll({ order: [['createdAt', 'ASC']] });
  }

  static async ajouterConfig({ cle, valeur, description, adminId }) {
    const existe = await ConfigApp.findOne({ where: { cle } });
    if (existe) throw new ConflictError(`La configuration "${cle}" existe déjà. Utilisez la modification.`);
    const config = await ConfigApp.create({ cle, valeur, description, modifiePar: adminId });
    _cache.delete(cle);
    return { message: 'Configuration ajoutée avec succès', config };
  }

  static async modifierConfig({ cle, valeur, description, adminId }) {
    const config = await ConfigApp.findOne({ where: { cle } });
    if (!config) throw new NotFoundError(`Configuration "${cle}" introuvable`);
    await config.update({ valeur, description: description ?? config.description, modifiePar: adminId });
    _cache.delete(cle);
    return { message: 'Configuration mise à jour avec succès', config };
  }

  /** Pour les tests : repartir d'un cache vide. */
  static _viderCache() {
    _cache.clear();
  }
}

module.exports = ConfigService;
