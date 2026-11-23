const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// BE-1 (docs/specs/cierre-pendientes.md, frontend): el gateway no deja pasar desde
// Internet las rutas internas entre servicios, el lookup de admin, la publicación de
// eventos de notification ni el Swagger (salvo DOCS_PUBLIC=true, en docsPublic.test.js).

let echoServer;
let gatewayServer;
let gatewayUrl;
// Rutas que llegaron al eco (a cualquier servicio, incluido admin /auth/me).
const echoHits = [];

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const close = (server) => {
  if (!server) return Promise.resolve();
  server.closeAllConnections();
  return new Promise((resolve) => server.close(resolve));
};

before(async () => {
  // Todos los servicios apuntan al eco: si una ruta pasara, respondería 200.
  echoServer = http.createServer((req, res) => {
    echoHits.push(req.url);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ url: req.url }));
  });
  await listen(echoServer);
  const echo = `http://127.0.0.1:${echoServer.address().port}`;
  for (const name of ['ADMIN', 'CREW', 'FLIGHTS', 'RECOMMENDATION', 'NOTIFICATION']) {
    process.env[`${name}_SERVICE_URL`] = echo;
  }
  delete process.env.DOCS_PUBLIC;
  const app = require('../src/app');
  gatewayServer = http.createServer(app);
  await listen(gatewayServer);
  gatewayUrl = `http://127.0.0.1:${gatewayServer.address().port}`;
});

after(async () => {
  await close(gatewayServer);
  await close(echoServer);
});

const BLOCKED = [
  ['GET', '/api/crew/internal/crew-members'],
  ['DELETE', '/api/crew/internal/crew-members/abc'],
  ['GET', '/api/admin/internal/sessions'],
  // Eliminar usuarios (EU-10): las rutas internas nuevas de cada servicio.
  ['DELETE', '/api/flights/internal/users/abc/assignments'],
  ['POST', '/api/notification/internal/alerts/slot-vacated'],
  ['DELETE', '/api/notification/internal/users/abc/notifications'],
  ['DELETE', '/api/recommendation/internal/users/abc/suggestions'],
  ['DELETE', '/api/crew/internal/users/abc'],
  ['GET', '/api/admin/users/lookup?ids=1'],
  ['POST', '/api/notification/events/absence-reported'],
  ['GET', '/api/admin/docs'],
  ['GET', '/api/crew/docs/openapi.json'],
  ['GET', '/api/notification/docs/'],
  // Variantes que Express también enrutaría al servicio.
  ['GET', '/api/CREW/Internal/crew-members'],
  ['GET', '/api/crew//internal/crew-members'],
  ['GET', '/api/crew/%69nternal/crew-members'],
  ['POST', '/api/notification/Events/absence-reported'],
];

for (const [method, path] of BLOCKED) {
  test(`BE-1: ${method} ${path} responde 404 desde el gateway y no llega al servicio`, async () => {
    const response = await fetch(`${gatewayUrl}${path}`, { method });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Ruta no encontrada.' });
  });
}

const ALLOWED = [
  ['GET', '/api/admin/users'],
  ['POST', '/api/admin/auth/bootstrap/super-admin'],
  ['GET', '/api/crew/crew-members/me'],
  ['GET', '/api/notification/notifications'],
  ['GET', '/api/flights/aircraft'],
  // La ruta pública de eliminar usuarios (EU-10) sí llega a admin.
  ['DELETE', '/api/admin/users/abc/permanent'],
  // Nombres que solo se parecen a las rutas bloqueadas.
  ['GET', '/api/admin/users/lookups-report'],
  ['GET', '/api/crew/internals'],
];

for (const [method, path] of ALLOWED) {
  test(`BE-1: ${method} ${path} sigue llegando al servicio`, async () => {
    const response = await fetch(`${gatewayUrl}${path}`, { method });
    assert.equal(response.status, 200);
  });
}

// fetch normaliza los segmentos «.» y «..»; un cliente a mano no. Se envían tal cual.
const rawGet = (path) =>
  new Promise((resolve, reject) => {
    const { hostname, port } = new URL(gatewayUrl);
    const req = http.request({ hostname, port, path, method: 'GET' }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });

for (const path of [
  '/api/crew/./internal/crew-members',
  '/api/crew/x/../internal/crew-members',
  '/api/crew/%2e%2e/crew/internal/crew-members',
]) {
  test(`BE-1: GET ${path} (sin normalizar) responde 404`, async () => {
    assert.equal(await rawGet(path), 404);
  });
}

// Revisión final: http-proxy reenvía `url.parse(req.url).path`, que cambia «\» por «/»
// y corta en «#». Una petición con «\», «#» o caracteres de control (también
// codificados), o que no empieza por «/» (forma absoluta), no llega a ningún servicio.
const JWT = 'Bearer aaa.bbb.ccc';

const rawRequest = (method, path, headers = {}) =>
  new Promise((resolve, reject) => {
    const { hostname, port } = new URL(gatewayUrl);
    const req = http.request({ hostname, port, path, method, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });

const RAW_BLOCKED = [
  ['GET', '/api/crew/internal\\crew-members'],
  ['POST', '/api/notification/events\\absence-reported'],
  ['GET', '/api/admin/users\\lookup?ids=1'],
  ['GET', '/api/admin/docs#'],
  ['GET', '/api/admin/docs#/../users'],
  ['DELETE', '/api/flights/internal\\users/abc/assignments'],
  ['POST', '/api/notification/internal\\alerts/slot-vacated'],
  ['DELETE', '/api/recommendation/internal\\users/abc/suggestions'],
  // Codificados: tras decodificar son «\», «#» o caracteres de control.
  ['GET', '/api/crew/internal%5Ccrew-members'],
  ['GET', '/api/crew/internal%5ccrew-members'],
  ['GET', '/api/admin/docs%23'],
  ['GET', '/api/admin/users%23/lookup'],
  ['GET', '/api/crew/crew-members%00'],
  ['GET', '/api/crew/crew-members%0A'],
  ['GET', '/api/crew/crew-members%7F'],
  // Forma absoluta (`GET http://host/ruta`): Express la enrutaría igual.
  ['GET', 'http://x/api/crew/internal/crew-members'],
  ['DELETE', 'http://x/api/flights/internal/users/abc/assignments'],
  ['POST', 'http://x/api/notification/internal/alerts/slot-vacated'],
  ['DELETE', 'http://x/api/recommendation/internal/users/abc/suggestions'],
  ['GET', 'http://x/api/admin/docs'],
  ['GET', 'http://x/api/crew/crew-members/me'],
  // La exención de sesión de /api/admin/auth/* no vale para una ruta no canónica.
  ['GET', '/api/admin/auth/..\\users'],
];

for (const [method, path] of RAW_BLOCKED) {
  test(`Revisión: ${method} ${path} (a mano) responde 404 y no llega a ningún servicio`, async () => {
    const before = echoHits.length;

    const res = await rawRequest(method, path, { Authorization: JWT });

    assert.equal(res.status, 404);
    assert.deepEqual(JSON.parse(res.body), { error: 'Ruta no encontrada.' });
    assert.deepEqual(echoHits.slice(before), []);
  });
}

const RAW_ALLOWED = [
  // «%23» en el valor de un parámetro de búsqueda es legítimo.
  ['GET', '/api/admin/users?search=%23ops'],
  ['GET', '/api/crew/crew-members?note=a%5Cb'],
];

for (const [method, path] of RAW_ALLOWED) {
  test(`Revisión: ${method} ${path} sigue llegando al servicio`, async () => {
    const res = await rawRequest(method, path, { Authorization: JWT });

    assert.equal(res.status, 200);
  });
}
