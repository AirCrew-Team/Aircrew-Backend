const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// BE-2 (D1): una sesión anulada recibe 401 session_revoked en el gateway y no llega
// al servicio. Cada test usa su propio token: la caché del gateway dura todo el archivo.

const REVOKED_BODY = { error: 'La sesión ya no es válida.', code: 'session_revoked' };

let adminServer;
let serviceServer;
let gatewayServer;
let gatewayUrl;
// Peticiones recibidas: [url, authorization, body].
const adminHits = [];
const serviceHits = [];

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const close = (server) => {
  if (!server) return Promise.resolve();
  server.closeAllConnections();
  return new Promise((resolve) => server.close(resolve));
};

function recorder(hits, respond) {
  return http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      hits.push({ url: req.url, authorization: req.headers.authorization, body });
      respond(req, res);
    });
  });
}

before(async () => {
  // Admin falso: /auth/me responde 401 a los tokens «anulado» y 200 al resto.
  adminServer = recorder(adminHits, (req, res) => {
    const authorization = req.headers.authorization || '';
    // Como verifyJwt de admin: sin «Bearer » responde auth_required.
    if (req.url === '/auth/me' && !authorization.startsWith('Bearer ')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Se requiere autenticación.', code: 'auth_required' }));
    }
    const revoked = authorization.startsWith('Bearer anulado');
    if (req.url === '/auth/me' && revoked) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(REVOKED_BODY));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ service: 'admin', url: req.url }));
  });
  serviceServer = recorder(serviceHits, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ service: 'otro', url: req.url }));
  });
  await listen(adminServer);
  await listen(serviceServer);
  const service = `http://127.0.0.1:${serviceServer.address().port}`;
  for (const name of ['CREW', 'FLIGHTS', 'RECOMMENDATION', 'NOTIFICATION']) {
    process.env[`${name}_SERVICE_URL`] = service;
  }
  process.env.ADMIN_SERVICE_URL = `http://127.0.0.1:${adminServer.address().port}`;
  delete process.env.DOCS_PUBLIC;
  const app = require('../src/app');
  gatewayServer = http.createServer(app);
  await listen(gatewayServer);
  gatewayUrl = `http://127.0.0.1:${gatewayServer.address().port}`;
});

after(async () => {
  await close(gatewayServer);
  await close(serviceServer);
  await close(adminServer);
});

const sessionChecks = (token) =>
  adminHits.filter((hit) => hit.url === '/auth/me' && hit.authorization === `Bearer ${token}`)
    .length;
const reachedService = (token) =>
  serviceHits.filter((hit) => hit.authorization === `Bearer ${token}`).length;

async function call(path, { token, cookie, method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = `aircrew_token=${cookie}`;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${gatewayUrl}${path}`, { method, headers, body });
  return { status: response.status, body: await response.json() };
}

test('BE-2: un token anulado (header) recibe 401 session_revoked y no llega a crew', async () => {
  const res = await call('/api/crew/crew-members/me', { token: 'anulado-header' });

  assert.equal(res.status, 401);
  assert.deepEqual(res.body, REVOKED_BODY);
  assert.equal(reachedService('anulado-header'), 0);
});

test('BE-2: un token anulado (cookie aircrew_token) recibe 401 session_revoked y no llega a crew', async () => {
  const res = await call('/api/crew/crew-members/me', { cookie: 'anulado-cookie' });

  assert.equal(res.status, 401);
  assert.deepEqual(res.body, REVOKED_BODY);
  assert.equal(reachedService('anulado-cookie'), 0);
});

for (const service of ['flights', 'recommendation', 'notification']) {
  test(`BE-2: un token anulado también recibe 401 session_revoked en ${service}`, async () => {
    const token = `anulado-${service}`;

    const res = await call(`/api/${service}/algo`, { token });

    assert.equal(res.status, 401);
    assert.deepEqual(res.body, REVOKED_BODY);
    assert.equal(reachedService(token), 0);
  });
}

test('BE-2: las rutas de admin fuera de /auth también se validan', async () => {
  const res = await call('/api/admin/users/me', { token: 'anulado-admin' });

  assert.equal(res.status, 401);
  assert.deepEqual(res.body, REVOKED_BODY);
  assert.equal(adminHits.filter((hit) => hit.url === '/users/me').length, 0);
});

test('BE-2: con una sesión válida la petición llega a crew con su token, y se valida una vez', async () => {
  const res = await call('/api/crew/crew-members/me', { token: 'valido-1' });

  assert.equal(res.status, 200);
  assert.equal(res.body.url, '/crew-members/me');
  assert.equal(reachedService('valido-1'), 1);
  assert.equal(sessionChecks('valido-1'), 1);
});

test('BE-2: la segunda petición con el mismo token no vuelve a preguntar a admin', async () => {
  await call('/api/crew/crew-members/me', { token: 'valido-2' });
  await call('/api/flights/aircraft', { token: 'valido-2' });

  assert.equal(sessionChecks('valido-2'), 1);
  assert.equal(reachedService('valido-2'), 2);
});

test('BE-2: un POST con body pasa la validación y llega intacto al servicio', async () => {
  const body = JSON.stringify({ reason: 'Médica', notes: 'Cita a las 9' });

  const res = await call('/api/crew/absences', { token: 'valido-post', method: 'POST', body });

  assert.equal(res.status, 200);
  const hit = serviceHits.find((candidate) => candidate.authorization === 'Bearer valido-post');
  assert.equal(hit.body, body);
});

for (const path of [
  '/api/admin/auth/login',
  '/api/admin/auth/logout',
  '/api/admin/auth/change-password',
  '/api/admin/auth/bootstrap/super-admin',
]) {
  test(`BE-2: POST ${path} no pasa por la validación de la sesión`, async () => {
    const token = `anulado-${path}`;

    const res = await call(path, { token, method: 'POST', body: '{}' });

    assert.equal(res.status, 200);
    assert.equal(res.body.url, path.replace('/api/admin', ''));
    assert.equal(sessionChecks(token), 0);
  });
}

test('BE-2: GET /api/admin/auth/me llega a admin una sola vez (sin validación previa)', async () => {
  const res = await call('/api/admin/auth/me', { token: 'valido-me' });

  assert.equal(res.status, 200);
  assert.equal(sessionChecks('valido-me'), 1);
});

test('BE-2: /api/admin/authx no queda exento por parecerse a /auth', async () => {
  const res = await call('/api/admin/authx', { token: 'anulado-authx' });

  assert.equal(res.status, 401);
  assert.deepEqual(res.body, REVOKED_BODY);
});

test('BE-2: sin token no se pregunta a admin', async () => {
  const before = adminHits.length;

  const res = await call('/api/crew/crew-members/me');

  assert.equal(res.status, 200);
  assert.equal(adminHits.length, before);
});

test('BE-2: las rutas bloqueadas de BE-1 siguen dando 404 aunque lleven token', async () => {
  const before = adminHits.length;

  const res = await call('/api/crew/internal/crew-members', { token: 'valido-bloqueada' });

  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: 'Ruta no encontrada.' });
  assert.equal(adminHits.length, before);
});

// Notification lee la cookie aircrew_token si el Authorization no es Bearer (el SSE):
// con otro esquema en el header, la cookie anulada no debe llegar a /stream.
test('BE-2: con Authorization no Bearer y una cookie anulada, /api/notification/stream no llega al servicio', async () => {
  const before = serviceHits.length;
  const response = await fetch(`${gatewayUrl}/api/notification/stream`, {
    headers: { Authorization: 'Basic eA==', Cookie: 'aircrew_token=anulado-sse' },
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: 'Se requiere autenticación.',
    code: 'auth_required',
  });
  assert.equal(serviceHits.length, before);
});
