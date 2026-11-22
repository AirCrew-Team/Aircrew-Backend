const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// BE-1: con DOCS_PUBLIC=true el Swagger vuelve a ser público; las rutas internas, no.

let echoServer;
let gatewayServer;
let gatewayUrl;

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const close = (server) => {
  if (!server) return Promise.resolve();
  server.closeAllConnections();
  return new Promise((resolve) => server.close(resolve));
};

before(async () => {
  echoServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  await listen(echoServer);
  const echo = `http://127.0.0.1:${echoServer.address().port}`;
  for (const name of ['ADMIN', 'CREW', 'FLIGHTS', 'RECOMMENDATION', 'NOTIFICATION']) {
    process.env[`${name}_SERVICE_URL`] = echo;
  }
  process.env.DOCS_PUBLIC = 'true';
  const app = require('../src/app');
  gatewayServer = http.createServer(app);
  await listen(gatewayServer);
  gatewayUrl = `http://127.0.0.1:${gatewayServer.address().port}`;
});

after(async () => {
  await close(gatewayServer);
  await close(echoServer);
});

test('BE-1: con DOCS_PUBLIC=true, GET /api/admin/docs llega al servicio', async () => {
  const response = await fetch(`${gatewayUrl}/api/admin/docs`);
  assert.equal(response.status, 200);
});

test('BE-1: con DOCS_PUBLIC=true, las rutas internas siguen cerradas', async () => {
  const response = await fetch(`${gatewayUrl}/api/crew/internal/crew-members`);
  assert.equal(response.status, 404);
});
