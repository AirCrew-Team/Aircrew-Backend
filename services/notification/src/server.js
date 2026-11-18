const http = require('http');
const { port, nameService } = require('./config/env');
const app = require('./app');
const { createSocketServer } = require('./adapters/inbound/websocket/socketServer');
const socketPublisher = require('./adapters/outbound/publishers/socketPublisher');

// HTTP y WebSocket comparten el mismo puerto.
const server = http.createServer(app);
socketPublisher.attach(createSocketServer(server));

server.listen(port, () => {
  console.log(`${nameService} corriendo en el puerto ${port}`);
});
