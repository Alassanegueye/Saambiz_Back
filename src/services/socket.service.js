// services/socket.service.js
// Temps réel (messagerie + notifications) via Socket.IO
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { jwtConfig, corsConfig } = require('../config/security');
const Utilisateur = require('../models/utilisateur.model');
const TokenBlacklist = require('../models/tokenBlacklist.model');
const logger = require('../utils/logger');

let io = null;

// Authentification de la poignée de main.
//
// La signature seule ne suffit pas : un jeton d'accès reste signé et non
// expiré après une déconnexion, un changement de mot de passe ou une
// suppression de compte — ces gestes le mettent en LISTE NOIRE, et c'est
// elle qui coupe l'accès. Ce middleware ne la consultait pas, alors que le
// middleware HTTP le fait : un jeton révoqué ouvrait donc encore un socket
// et rejoignait la salle `user:<id>`, d'où il continuait de recevoir les
// messages et notifications du compte. Se déconnecter ne coupait pas le
// temps réel.
//
// Le statut du compte est vérifié pour la même raison : un compte suspendu
// gardait son fil temps réel ouvert (équivalent de `checkActiveUser`).
async function socketAuthMiddleware(socket, next) {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Token manquant ou invalide'));
    }

    // Signature d'abord, aucune I/O : un jeton forgé est rejeté sans
    // faire travailler PostgreSQL (même ordre que le middleware HTTP).
    const decoded = jwt.verify(token, jwtConfig.secret);

    const revoque = await TokenBlacklist.findOne({ where: { token } });
    if (revoque) {
      return next(new Error('Token révoqué'));
    }

    const utilisateur = await Utilisateur.findByPk(decoded.id, {
      attributes: ['id', 'statut'],
    });
    if (!utilisateur) {
      return next(new Error('Utilisateur introuvable'));
    }
    if (utilisateur.statut !== 'actif') {
      return next(new Error('Compte désactivé'));
    }

    socket.userId = utilisateur.id;
    return next();
  } catch (err) {
    logger.error('socket.service:auth', { message: err.message });
    return next(new Error('Token invalide'));
  }
}

/**
 * Coupe les connexions temps réel déjà ouvertes d'un compte.
 *
 * Vérifier la liste noire à la poignée de main empêche une NOUVELLE
 * connexion avec un jeton révoqué, mais ne ferme pas celles qui sont déjà
 * établies : un socket ouvert avant la déconnexion continuerait de recevoir
 * les messages. Appelé à la déconnexion, au changement de mot de passe et à
 * la suppression de compte.
 *
 * Silencieux si Socket.IO n'est pas initialisé (tests, tâches planifiées) :
 * l'absence de temps réel ne doit pas faire échouer une déconnexion.
 */
function couperSocketsUtilisateur(utilisateurId) {
  if (!io || !utilisateurId) return;
  try {
    io.in('user:' + utilisateurId).disconnectSockets(true);
  } catch (err) {
    logger.warn('socket.service:coupure', { message: err.message });
  }
}
function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: corsConfig,
  });

  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    socket.join('user:' + socket.userId);
    logger.info('[socket] connecté', { userId: socket.userId });

    socket.on('disconnect', () => {
      logger.info('[socket] déconnecté', { userId: socket.userId });
    });
  });

  return io;
}

function getIO() {
  if (!io) {
    throw new Error('Socket.IO non initialisé — appelez initSocket(httpServer) au démarrage du serveur.');
  }
  return io;
}

module.exports = { initSocket, getIO, couperSocketsUtilisateur };
