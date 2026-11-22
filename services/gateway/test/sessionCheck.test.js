const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

// BE-2 (D1, docs/specs/cierre-pendientes.md, frontend): el gateway pregunta a admin
// (GET /auth/me) si la sesión del token sigue valiendo, con una caché de 30 s.

const REVOKED_BODY = { error: 'La sesión ya no es válida.', code: 'session_revoked' };
const UNAVAILABLE_BODY = { error: 'No se pudo validar la sesión. Intenta de nuevo.' };

let adminServer;
let adminUrl;
// Llamadas a /auth/me por cabecera Authorization.
const adminCalls = new Map();

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const close = (server) => {
  if (!server) return Promise.resolve();
  server.closeAllConnections();
  return new Promise((resolve) => server.close(resolve));
};

// Admin falso: la respuesta depende del token. «lento» no responde nunca.
before(async () => {
  adminServer = http.createServer((req, res) => {
    const authorization = req.headers.authorization || '';
    adminCalls.set(authorization, (adminCalls.get(authorization) || 0) + 1);
    if (req.url !== '/auth/me') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end('{}');
    }
    // Como verifyJwt de admin: sin «Bearer » responde auth_required.
    if (!authorization.startsWith('Bearer ')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Se requiere autenticación.', code: 'auth_required' }));
    }
    if (authorization.startsWith('Bearer valido')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ id: 'cuenta' }));
    }
    if (authorization.startsWith('Bearer anulado')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(REVOKED_BODY));
    }
    if (authorization.startsWith('Bearer caido')) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Error interno del servidor.' }));
    }
    if (authorization.startsWith('Bearer raro')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end('{}');
    }
    if (authorization.startsWith('Bearer sinjson')) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      return res.end('no autorizado');
    }
    // «lento»: se queda sin responder.
    return undefined;
  });
  await listen(adminServer);
  adminUrl = `http://127.0.0.1:${adminServer.address().port}`;
});

after(async () => {
  await close(adminServer);
});

function createClock() {
  const clock = { time: 1_000_000 };
  clock.now = () => clock.time;
  return clock;
}

// App mínima: la validación y, detrás, un servicio que responde «pasó».
async function startApp(t, options = {}) {
  const { createSessionCheck } = require('../src/adapters/inbound/http/sessionCheck');
  const clock = createClock();
  const app = express();
  app.use(createSessionCheck({ adminUrl, now: clock.now, ...options }));
  app.use((req, res) => res.json({ passed: true }));
  const server = http.createServer(app);
  await listen(server);
  t.after(() => close(server));
  const url = `http://127.0.0.1:${server.address().port}`;
  const get = async (authorization) => {
    const response = await fetch(`${url}/api/crew/crew-members`, {
      headers: authorization ? { Authorization: authorization } : {},
    });
    return { status: response.status, body: await response.json() };
  };
  return { clock, get };
}

const callsOf = (authorization) => adminCalls.get(authorization) || 0;

test('BE-2: con una sesión válida (200 de admin) la petición sigue', async (t) => {
  const { get } = await startApp(t);

  const res = await get('Bearer valido-1');

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { passed: true });
  assert.equal(callsOf('Bearer valido-1'), 1);
});

test('BE-2: con una sesión anulada responde 401 con el cuerpo de admin (code session_revoked)', async (t) => {
  const { get } = await startApp(t);

  const res = await get('Bearer anulado-1');

  assert.equal(res.status, 401);
  assert.deepEqual(res.body, REVOKED_BODY);
});

test('BE-2: sin Authorization no pregunta a admin y la petición sigue', async (t) => {
  const { get } = await startApp(t);
  const before = callsOf('');

  const res = await get(undefined);

  assert.equal(res.status, 200);
  assert.equal(callsOf(''), before);
});

// Notification acepta la cookie aircrew_token si el Authorization no es Bearer:
// cualquier Authorization se valida, para que esa cookie no se salte la comprobación.
test('BE-2: un Authorization que no es Bearer también se valida (admin responde 401)', async (t) => {
  const { get } = await startApp(t);

  const res = await get('Basic abc');

  assert.equal(res.status, 401);
  assert.deepEqual(res.body, { error: 'Se requiere autenticación.', code: 'auth_required' });
  assert.equal(callsOf('Basic abc'), 1);
});

test('BE-2: la segunda petición con el mismo token antes de 30 s no vuelve a llamar a admin', async (t) => {
  const { clock, get } = await startApp(t);

  await get('Bearer valido-2');
  clock.time += 29_999;
  const res = await get('Bearer valido-2');

  assert.equal(res.status, 200);
  assert.equal(callsOf('Bearer valido-2'), 1);
});

test('BE-2: a los 30 s se vuelve a preguntar a admin', async (t) => {
  const { clock, get } = await startApp(t);

  await get('Bearer valido-3');
  clock.time += 30_000;
  await get('Bearer valido-3');

  assert.equal(callsOf('Bearer valido-3'), 2);
});

test('BE-2: el 401 también se guarda 30 s', async (t) => {
  const { clock, get } = await startApp(t);

  await get('Bearer anulado-2');
  clock.time += 10_000;
  const res = await get('Bearer anulado-2');

  assert.equal(res.status, 401);
  assert.deepEqual(res.body, REVOKED_BODY);
  assert.equal(callsOf('Bearer anulado-2'), 1);
});

test('BE-2: un 5xx de admin responde 503 y no se guarda', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { get } = await startApp(t);

  const first = await get('Bearer caido-1');
  const second = await get('Bearer caido-1');

  assert.equal(first.status, 503);
  assert.deepEqual(first.body, UNAVAILABLE_BODY);
  assert.equal(second.status, 503);
  assert.equal(callsOf('Bearer caido-1'), 2);
});

test('BE-2: cualquier otro estado de admin (p. ej. 404) responde 503', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { get } = await startApp(t);

  const res = await get('Bearer raro-1');

  assert.equal(res.status, 503);
  assert.deepEqual(res.body, UNAVAILABLE_BODY);
});

test('BE-2: un 401 de admin sin JSON responde 503 y no se guarda', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { get } = await startApp(t);

  await get('Bearer sinjson-1');
  const res = await get('Bearer sinjson-1');

  assert.equal(res.status, 503);
  assert.equal(callsOf('Bearer sinjson-1'), 2);
});

test('BE-2: si admin no responde a tiempo, responde 503', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { get } = await startApp(t, { timeoutMs: 100 });

  const res = await get('Bearer lento-1');

  assert.equal(res.status, 503);
  assert.deepEqual(res.body, UNAVAILABLE_BODY);
});

test('BE-2: con admin caído (sin servidor) responde 503', async (t) => {
  t.mock.method(console, 'error', () => {});
  const closed = http.createServer();
  await listen(closed);
  const deadUrl = `http://127.0.0.1:${closed.address().port}`;
  await close(closed);
  const { get } = await startApp(t, { adminUrl: deadUrl });

  const res = await get('Bearer valido-4');

  assert.equal(res.status, 503);
  assert.deepEqual(res.body, UNAVAILABLE_BODY);
});

test('BE-2: el tiempo de espera por defecto es de 3 s', () => {
  const { TIMEOUT_MS, TTL_MS, MAX_ENTRIES } = require('../src/adapters/inbound/http/sessionCheck');

  assert.equal(TIMEOUT_MS, 3000);
  assert.equal(TTL_MS, 30_000);
  assert.equal(MAX_ENTRIES, 5000);
});

test('BE-2: al superar 5000 tokens guardados, la caché se vacía', async (t) => {
  // fetch sustituido: 5001 tokens contra el servidor falso tardarían demasiado.
  const asked = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    asked.push(options.headers.authorization);
    return new Response('{}', { status: 200 });
  });
  const { createSessionCheck } = require('../src/adapters/inbound/http/sessionCheck');
  const check = createSessionCheck({ adminUrl, now: () => 0 });
  const run = (authorization) =>
    new Promise((resolve) => {
      check({ headers: { authorization } }, { status: () => ({ json: resolve }) }, resolve);
    });

  for (let index = 0; index < 5000; index += 1) await run(`Bearer t-${index}`);
  await run('Bearer t-0');
  assert.equal(asked.filter((value) => value === 'Bearer t-0').length, 1, 'con 5000 sigue en caché');

  await run('Bearer t-5000');
  await run('Bearer t-0');
  assert.equal(asked.filter((value) => value === 'Bearer t-0').length, 2, 'la 5001.ª vacía la caché');
});
