const { canReceiveAlerts } = require('../../../domain/alerts');

// Publicador de alertas sobre SSE (Server-Sent Events). Cada pestaña abierta es
// una conexión GET /stream que queda abierta; aquí se guardan para escribirles.
// Una persona puede tener varias conexiones (varias pestañas o equipos).
const connections = new Set();

// Una línea de SSE: «event: <tipo>» y «data: <json>», separadas por una línea vacía.
function writeEvent(res, type, data) {
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

// Registra una conexión; devuelve la función que la quita al cerrarse.
// preferences.disabledTypes: tipos que la persona apagó; se lee en cada envío, así que
// quien abrió la conexión puede actualizarlo mientras siga abierta.
function addConnection(user, res, preferences = { disabledTypes: [] }) {
  const connection = { user, res, preferences };
  connections.add(connection);
  return () => connections.delete(connection);
}

function sendTo(filter, alert) {
  let delivered = 0;

  for (const connection of connections) {
    if (filter(connection.user) && !connection.preferences.disabledTypes.includes(alert.type)) {
      writeEvent(connection.res, alert.type, alert);
      delivered += 1;
    }
  }

  return delivered;
}

// Alertas operativas: a todos los supervisores conectados.
function publishToSupervisors(alert) {
  return sendTo((user) => canReceiveAlerts(user), alert);
}

// Aviso para una sola persona (todas sus conexiones abiertas).
function publishToUser(userId, alert) {
  return sendTo((user) => user.id === userId, alert);
}

function connectionCount() {
  return connections.size;
}

module.exports = {
  writeEvent,
  addConnection,
  publishToSupervisors,
  publishToUser,
  connectionCount,
};
