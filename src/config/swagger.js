const swaggerJsdoc = require('swagger-jsdoc');

/**
 * Documentation OpenAPI, servie sur /saambiz-api.
 *
 * Les descriptions de routes vivent en commentaires `@swagger` dans les
 * fichiers de `src/routes/` : au plus près du code, elles ont une chance de
 * suivre ses évolutions. Une documentation dans un fichier séparé diverge en
 * trois semaines.
 */
const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'API SaamBiz',
      version: '1.0.0',
      description: [
        "Marketplace SaamBiz — API consommée par l'application mobile,",
        "l'espace vendeur web et l'administration.",
        '',
        '**Authentification** : jeton Bearer obtenu par `POST /auth/login`.',
        "Le jeton d'accès vaut 1 h ; `POST /auth/refresh` le prolonge et fait",
        'tourner le jeton de rafraîchissement — l\'ancien devient inutilisable.',
        '',
        '**Format des réponses** : `{ success, message, data }` en cas de succès,',
        '`{ success, message, details? }` en cas d\'échec.',
      ].join('\n'),
    },
    servers: [
      { url: 'http://localhost:5000/saambiz/v1', description: 'Développement local' },
      { url: 'https://saambiz-backend.onrender.com/saambiz/v1', description: 'Production' },
      {
        url: 'https://saambiz-backend.onrender.com/saambiz',
        description: 'Alias historique sans version — déprécié, conservé pour les applications mobiles installées',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: {
        Succes: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Opération réussie.' },
            data: { type: 'object', nullable: true },
          },
        },
        Erreur: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'Ressource introuvable.' },
            details: {
              type: 'array',
              nullable: true,
              items: {
                type: 'object',
                properties: {
                  champ: { type: 'string', example: 'prix' },
                  message: { type: 'string', example: 'Doit être un nombre positif' },
                },
              },
            },
          },
        },
      },
      responses: {
        NonAuthentifie: {
          description: 'Jeton absent, invalide ou expiré',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Erreur' } } },
        },
        DroitsInsuffisants: {
          description: "Identité connue, mais permission manquante sur ce menu",
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Erreur' } } },
        },
        Introuvable: {
          description: 'Ressource inexistante ou invisible pour cet appelant',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Erreur' } } },
        },
        Invalide: {
          description: 'Contenu refusé — le détail par champ est dans `details`',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Erreur' } } },
        },
        TropDeRequetes: {
          description: 'Limite de débit atteinte',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Erreur' } } },
        },
      },
    },
    tags: [
      { name: 'Authentification', description: 'Connexion, sessions, mot de passe' },
      { name: 'Compte', description: "Profil de l'utilisateur connecté" },
      { name: 'Vendeur', description: 'Boutique, produits, commandes, abonnement' },
      { name: 'Acheteur', description: 'Découverte des boutiques et des produits' },
      { name: 'Commandes', description: 'Panier, acompte, suivi' },
      { name: 'Admin', description: 'Administration — permissions RBAC requises' },
    ],
  },

  apis: ['./src/routes/**/*.js'],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
