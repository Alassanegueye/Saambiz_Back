const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Boutique = sequelize.define('Boutique', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  nom: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  // Identifiant lisible pour l'URL publique de la boutique (ex: /boutique/mode-dakar)
  slug: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: true,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  // Phrase d'accroche affichée sur la vitrine
  slogan: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  localisation: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  telephone: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: true
  },
   logo: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  // Image de couverture / bannière de la vitrine
  banniere: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  // Couleur d'accent du thème de la boutique (hex)
  couleur_theme: {
    type: DataTypes.STRING(9),
    allowNull: true,
  },
  // Catégorie/type de la boutique (Mode, Électronique, Beauté…) — libre
  categorie: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  // État de la boutique (visible / masquée / suspendue par l'admin)
  statut: {
    type: DataTypes.ENUM('actif', 'inactif', 'suspendu'),
    defaultValue: 'actif',
    allowNull: false,
  },
  whatsapp: {
    type: DataTypes.STRING,
    allowNull: true
  },
  ville: {
    type: DataTypes.STRING,
    allowNull: true
  },
  latitude: {
    type: DataTypes.DECIMAL(10, 8),
    allowNull: true,
  },
  longitude: {
    type: DataTypes.DECIMAL(11, 8),
    allowNull: true,
  },
  // ── Vitrine web publique — saambiz.sn/b/<slug> ──────────────────────
  // Le vendeur ne choisit pas un site entier parmi des maquettes : il règle
  // un moteur unique. Une seule base de code à tenir, et un vendeur qui gère
  // sa boutique depuis son téléphone n'a pas à comparer des templates.

  // Le site est-il publié ? Un vendeur peut préparer sa vitrine avant de
  // l'ouvrir, ou la fermer sans fermer sa boutique dans l'application.
  // Faux par défaut : personne ne doit se retrouver avec un site public
  // qu'il n'a pas composé, encore moins un site vide portant son nom. La
  // publication est décidée à la fin de l'assistant, dans l'application.
  vitrineActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  // 'classique' | 'galerie' | 'catalogue' — voir MODELES_VITRINE.
  vitrineModele: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'classique',
  },
  // Couleur d'accent du site. Distincte de couleur_theme, qui pilote
  // l'affichage de la boutique DANS l'application : le vendeur peut vouloir
  // son site plus sobre que sa fiche, ou l'inverse.
  vitrineAccent: {
    type: DataTypes.STRING(9),
    allowNull: true,
  },
  vitrineApropos: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  // Bandeau d'annonce affiché en haut du site (« Livraison offerte à Dakar »).
  vitrineAnnonce: {
    type: DataTypes.STRING(180),
    allowNull: true,
  },
  vitrineHoraires: {
    type: DataTypes.STRING(160),
    allowNull: true,
  },
  // { facebook, instagram, tiktok, site }
  vitrineReseaux: {
    type: DataTypes.JSONB,
    allowNull: true,
  },
  // { apropos, avis, contact, categories } — sections qu'on allume ou éteint.
  vitrineSections: {
    type: DataTypes.JSONB,
    allowNull: true,
  },
  // Le site peut rester une vitrine sans caisse : certains vendeurs veulent
  // montrer leur catalogue et être appelés sur WhatsApp, rien de plus.
  vitrineCommande: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  vitrinePaiementLivraison: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  vitrineVues: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },

  // ── Ce que l'assistant de création a déduit ─────────────────────────

  // 'rond' | 'carre' | 'bandeau' | 'libre'. Décide de l'habillage du logo
  // dans l'en-tête : un logo rond rogné en carré perd ses bords, et un logo
  // portant le nom écrit, enfermé dans une pastille, devient illisible.
  vitrineLogoForme: {
    type: DataTypes.STRING(16),
    allowNull: true,
  },
  // Les couleurs relevées dans le logo, telles qu'elles ont été proposées.
  // Conservées pour que le vendeur retrouve ses choix sans re-téléverser.
  vitrinePalette: {
    type: DataTypes.JSONB,
    allowNull: true,
  },
  // Secteur déclaré : choisit la mise en page proposée et le ton des textes.
  vitrineSecteur: {
    type: DataTypes.STRING(32),
    allowNull: true,
  },
  vitrineActivite: {
    type: DataTypes.STRING(300),
    allowNull: true,
  },

  // Distinct de vitrineActive : « active » dit si le site est ouvert au
  // public — le vendeur le ferme et le rouvre quand il veut. « configurée »
  // dit s'il est passé par l'assistant, une fois pour toutes. Le tableau de
  // bord web s'appuie sur le second pour renvoyer vers l'application.
  vitrineConfiguree: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  vitrineCreeeLe: {
    type: DataTypes.DATE,
    allowNull: true,
  },

  vendeurId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
        model: 'utilisateur',
        key: 'id'
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE'
    },
}, {
  tableName: 'boutique',
  freezeTableName: true,
  indexes: [
    // Jointure fréquente : sans index, PostgreSQL parcourt la table entière.
    { fields: ['vendeur_id'] },
    // Chaque affichage d'une vitrine part du slug.
    { fields: ['slug'] },
  ],
  timestamps: true,
  paranoid: true, 
  underscored: true
});

module.exports = Boutique;
