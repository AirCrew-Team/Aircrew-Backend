const { SUPERVISORS_ROOM, userRoom } = require('../../../domain/alerts');

// Publicador de alertas sobre Socket.IO. El servidor de sockets se conecta
// al arrancar (attach); antes de eso no hay a quién entregar.
let io = null;

function attach(socketServer) {
  io = socketServer;
}

function publishToSupervisors(alert) {
  if (!io) {
    return 0;
  }

  io.to(SUPERVISORS_ROOM).emit(alert.type, alert);
  const room = io.sockets.adapter.rooms.get(SUPERVISORS_ROOM);
  return room ? room.size : 0;
}

// Aviso para una sola persona (todas sus conexiones abiertas).
function publishToUser(userId, alert) {
  if (!io) {
    return 0;
  }

  const room = userRoom(userId);
  io.to(room).emit(alert.type, alert);
  const connections = io.sockets.adapter.rooms.get(room);
  return connections ? connections.size : 0;
}

module.exports = { attach, publishToSupervisors, publishToUser };
