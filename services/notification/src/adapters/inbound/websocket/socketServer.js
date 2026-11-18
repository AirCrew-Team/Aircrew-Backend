const { Server } = require('socket.io');
const { corsOrigins } = require('../../../config/env');
const { verifyToken } = require('../auth/tokenVerifier');
const { canReceiveAlerts, SUPERVISORS_ROOM } = require('../../../domain/alerts');

// Abre Socket.IO sobre el mismo servidor HTTP. El cliente se conecta con
// io(url, { auth: { token } }); solo supervisores y super_admin quedan
// en la sala que recibe las alertas.
function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: corsOrigins },
  });

  io.use((socket, next) => {
    let user = null;

    try {
      user = verifyToken(socket.handshake.auth && socket.handshake.auth.token);
    } catch (error) {
      return next(new Error('El servicio de notificaciones no está configurado.'));
    }

    if (!user) {
      return next(new Error('El token no es válido o ya venció.'));
    }

    if (!canReceiveAlerts(user)) {
      return next(new Error('Solo los supervisores reciben alertas.'));
    }

    socket.data.user = user;
    return next();
  });

  io.on('connection', (socket) => {
    socket.join(SUPERVISORS_ROOM);
    socket.emit('connected', { message: 'Conectado a las alertas de AirCrew.' });
  });

  return io;
}

module.exports = { createSocketServer };
