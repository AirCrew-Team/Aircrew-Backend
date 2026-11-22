const { Server } = require('socket.io');
const { corsOrigins } = require('../../../config/env');
const { verifyToken } = require('../auth/tokenVerifier');
const {
  canReceiveAlerts,
  SUPERVISORS_ROOM,
  userRoom,
} = require('../../../domain/alerts');

// Socket.IO sobre el mismo servidor HTTP. El cliente se conecta con
// io(url, { auth: { token } }).
// - Todos entran a su sala personal (user:<id>): avisos solo para esa persona,
//   como un reemplazo asignado a un tripulante.
// - Supervisores y super_admin entran además a la sala de alertas operativas.
// Antes de que venza el token se emite auth:expired y se desconecta.
function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: corsOrigins },
  });

  io.use((socket, next) => {
    let result;

    try {
      result = verifyToken(socket.handshake.auth && socket.handshake.auth.token);
    } catch (error) {
      return next(new Error('El servicio de notificaciones no está configurado.'));
    }

    if (result.reason === 'expired') {
      return next(new Error('Tu sesión venció. Inicia sesión de nuevo.'));
    }

    if (!result.user) {
      return next(new Error('El token de autenticación no es válido.'));
    }

    socket.data.user = result.user;
    socket.data.expiresAt = result.expiresAt;
    return next();
  });

  io.on('connection', (socket) => {
    const { user, expiresAt } = socket.data;

    socket.join(userRoom(user.id));

    if (canReceiveAlerts(user)) {
      socket.join(SUPERVISORS_ROOM);
    }

    socket.emit('connected', { message: 'Conectado a las alertas de AirCrew.' });

    if (expiresAt) {
      const timer = setTimeout(() => {
        socket.emit('auth:expired', {
          message: 'Tu sesión venció. Inicia sesión de nuevo.',
        });
        socket.disconnect(true);
      }, Math.max(0, expiresAt - Date.now()));

      socket.on('disconnect', () => clearTimeout(timer));
    }
  });

  return io;
}

module.exports = { createSocketServer };
