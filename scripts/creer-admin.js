#!/usr/bin/env node
/**
 * Crée un administrateur avec TOUS les droits sur TOUS les menus, ou rétablit
 * l'accès d'un administrateur existant, sans passer par le dashboard : pour le
 * jour où plus personne ne peut se connecter, ou pour ouvrir le compte du
 * back-office KODAFRIK.
 *
 * Usage :
 *   node scripts/creer-admin.js <email> "<mot de passe>" [prénom] [nom]
 *
 * - Adresse inconnue : compte Admin créé, adresse considérée comme vérifiée.
 * - Admin existant, même supprimé depuis le dashboard : nouveau mot de passe,
 *   compte réactivé, toutes ses sessions fermées.
 * - Adresse d'un acheteur ou d'un vendeur : refus. Un client ne devient pas
 *   administrateur par une faute de frappe.
 * - Dans les deux premiers cas, accès complet à chaque menu existant. Un menu
 *   ajouté plus tard se donne depuis le dashboard, ou en relançant le script.
 *
 * Le mot de passe suit la politique habituelle (validators/auth.validator.js)
 * et n'est PAS provisoire (isFirstLogin à false) : c'est la personne qui lance
 * la commande, sur le serveur, qui le choisit. L'opération apparaît dans
 * l'activité des admins.
 */
require('dotenv').config({ quiet: true });
const bcrypt = require('bcryptjs');
const { sequelize, Utilisateur, Menu, Permission } = require('../src/models');
const { bcryptConfig } = require('../src/config/security');
const { passwordSchema } = require('../src/validators/auth.validator');
const RefreshTokenService = require('../src/services/refreshToken.service');
const AuditService = require('../src/services/audit.service');

const USAGE = 'Usage : node scripts/creer-admin.js <email> "<mot de passe>" [prénom] [nom]';
const FORMAT_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOUS_LES_DROITS = { canView: true, canCreate: true, canUpdate: true, canDelete: true };

async function creerAdmin({ email, motDePasse, prenom = 'Admin', nom = 'Kodafrik' }) {
  const adresse = String(email || '').trim().toLowerCase();
  if (!FORMAT_EMAIL.test(adresse)) throw new Error(`Adresse e-mail invalide : « ${email || ''} ».`);
  const { error } = passwordSchema.validate(motDePasse);
  if (error) throw new Error(error.message);

  const menus = await Menu.findAll({ attributes: ['id'] });
  if (!menus.length) throw new Error('Aucun menu en base : lancez d’abord « npm run seed:menus ».');

  const hash = await bcrypt.hash(motDePasse, bcryptConfig.saltRounds);

  const resultat = await sequelize.transaction(async (transaction) => {
    let admin = await Utilisateur.findOne({
      where: { email: adresse },
      paranoid: false,
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (admin && admin.role !== 'Admin') {
      throw new Error(`L’adresse ${adresse} appartient déjà à un compte « ${admin.role} » : choisissez-en une autre.`);
    }

    const existant = Boolean(admin);
    if (admin) {
      if (admin.isSoftDeleted()) await admin.restore({ transaction });
      await admin.update({
        mot_de_passe: hash,
        isFirstLogin: false,
        statut: 'actif',
        verifie: true,
        compteSupprime: false,
        dateSuppression: null,
      }, { transaction });
    } else {
      admin = await Utilisateur.create({
        nom,
        prenom,
        email: adresse,
        mot_de_passe: hash,
        role: 'Admin',
        statut: 'actif',
        verifie: true,
        isFirstLogin: false,
      }, { transaction });
    }

    for (const menu of menus) {
      const [permission, creee] = await Permission.findOrCreate({
        where: { userId: admin.id, menuId: menu.id },
        defaults: { userId: admin.id, menuId: menu.id, ...TOUS_LES_DROITS },
        transaction,
      });
      if (!creee) await permission.update(TOUS_LES_DROITS, { transaction });
    }
    return { id: admin.id, adresse, cree: !existant, menus: menus.length };
  });

  // Mot de passe remplacé : les sessions ouvertes avec l'ancien tombent.
  if (!resultat.cree) await RefreshTokenService.revoquerTout(resultat.id);
  await AuditService.enregistrer({
    adminId: resultat.id,
    action: resultat.cree ? 'creer_admin' : 'modifier_admin',
    cible: 'admin',
    cibleId: resultat.id,
    details: { email: adresse, origine: 'scripts/creer-admin.js', ...(resultat.cree ? {} : { mot_de_passe: 'réinitialisé' }) },
  });
  return resultat;
}

if (require.main === module) {
  const [email, motDePasse, prenom, nom] = process.argv.slice(2);
  if (!email || !motDePasse) {
    console.error(USAGE);
    process.exit(1);
  }
  creerAdmin({ email, motDePasse, prenom, nom })
    .then(async ({ adresse, cree, menus }) => {
      console.log(cree
        ? `Admin créé : ${adresse}`
        : `Admin ${adresse} : nouveau mot de passe enregistré, compte réactivé, sessions fermées.`);
      console.log(`Accès complet à ${menus} menu(s).`);
      await sequelize.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error(`Échec : ${err.message}`);
      await sequelize.close().catch(() => {});
      process.exit(1);
    });
}

module.exports = { creerAdmin };
