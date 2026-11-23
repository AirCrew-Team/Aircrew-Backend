const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const FRONTEND_ORIGIN = 'http://localhost:5173';

let echoServer;
let gatewayServer;
let gatewayUrl;

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function close(server) {
  if (!server) return Promise.resolve();
  server.closeAllConnections();
  return new Promise((resolve) => server.close(resolve));
}

before(async () => {
  // Servicio admin falso: responde con la URL y las cabeceras que recibe.
  echoServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ url: req.url, headers: req.headers }));
  });
  await listen(echoServer);

  // Antes del require: config/env lee las variables al cargarse, y dotenv
  // no pisa las que ya existen.
  process.env.CORS_ORIGINS = FRONTEND_ORIGIN;
  process.env.ADMIN_SERVICE_URL = `http://127.0.0.1:${echoServer.address().port}`;
  const app = require('../src/app');

  gatewayServer = http.createServer(app);
  await listen(gatewayServer);
  gatewayUrl = `http://127.0.0.1:${gatewayServer.address().port}`;
});

after(async () => {
  await close(gatewayServer);
  await close(echoServer);
});

test('LR-B5: GET /health desde un origen de CORS_ORIGINS permite credenciales y devuelve ese origen exacto', async () => {
  const response = await fetch(`${gatewayUrl}/health`, {
    headers: { Origin: FRONTEND_ORIGIN },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  assert.equal(response.headers.get('access-control-allow-origin'), FRONTEND_ORIGIN);
});

test('LR-B4 (integrado): GET /api/admin/eco con la cookie aircrew_token llega al servicio con Authorization: Bearer abc', async () => {
  const response = await fetch(`${gatewayUrl}/api/admin/eco`, {
    headers: { Cookie: 'aircrew_token=abc' },
  });

  assert.equal(response.status, 200);
  const echo = await response.json();
  assert.equal(echo.url, '/eco');
  assert.equal(echo.headers.cookie, 'aircrew_token=abc');
  assert.equal(echo.headers.authorization, 'Bearer abc');
});
