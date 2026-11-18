const { port, nameService, services } = require('./config/env');
const app = require('./app');
const { createSocketProxy } = require('./adapters/outbound/http/serviceProxy');

const server = app.listen(port, () => {
  console.log(`${nameService} corriendo en el puerto ${port}`);
});

// WebSocket de alertas: el navegador se conecta al gateway y este lo pasa a Notification.
const notificationSocket = createSocketProxy('notification', services.notification);
server.on('upgrade', notificationSocket.upgrade);
