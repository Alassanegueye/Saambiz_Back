// services/socket.service.js
// Temps réel (messagerie + notifications) via Socket.IO
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { jwtConfig, corsConfig } = require('../config/security');
const logger = require('../utils/logger');

let io = null;

// Middleware d'auth Socket.IO — même logique/secret que middlewares/auth.middleware.js
function socketAuthMiddleware(socket, next) {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Token manquant ou invalide'));
    }
    const decoded = jwt.verify(token, jwtConfig.secret);
    socket.userId = decoded.id;
    next();
  } catch (err) {
    logger.error('socket.service:auth', { message: err.message });
    next(new Error('Token invalide'));
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

module.exports = { initSocket, getIO };
