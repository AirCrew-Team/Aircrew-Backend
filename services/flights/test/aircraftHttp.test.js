const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const jwt = require('jsonwebtoken');

// Antes de cargar la app: dotenv no pisa una variable que ya existe.
process.env.JWT_SECRET = 'secreto-de-prueba';
const app = require('../src/app');
const pool = require('../src/adapters/outbound/persistence/pool');

// Ningún caso llega a PostgreSQL: terminan antes (sesión, rol, datos o tamaño).
const AIRCRAFT_ID = '11111111-1111-4111-8111-111111111111';

function tokenFor(role) {
  return jwt.sign({ role }, 'secreto-de-prueba', {
    subject: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
    issuer: 'aircrew-admin',
    expiresIn: '1h',
  });
}

function noDatabase(t) {
  t.mock.method(pool, 'query', async (sql) => {
    throw new Error(`Consulta inesperada en el test: ${sql}`);
  });
  t.mock.method(pool, 'connect', async () => {
    throw new Error('Conexión inesperada en el test.');
  });
}

async function request(path, { method = 'GET', role, body } = {}) {
  const server = app.listen(0);
  await once(server, 'listening');
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (role) headers.Authorization = `Bearer ${tokenFor(role)}`;
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers, body });
    const text = await response.text();
    const isJson = (response.headers.get('content-type') || '').includes('json');
    return { status: response.status, body: isJson && text ? JSON.parse(text) : text };
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

const SUPER_ADMIN_ROUTES = [
  ['GET', '/aircraft'],
  ['GET', '/aircraft/operating'],
  ['GET', '/aircraft/stats'],
  ['GET', '/aircraft/options'],
  ['GET', '/aircraft/manifest'],
  ['POST', '/aircraft'],
  ['PUT', `/aircraft/${AIRCRAFT_ID}`],
  ['DELETE', `/aircraft/${AIRCRAFT_ID}`],
  ['GET', `/aircraft/${AIRCRAFT_ID}/report`],
  ['PATCH', `/aircraft/${AIRCRAFT_ID}/maintenance/tasks/0`],
  ['POST', `/aircraft/${AIRCRAFT_ID}/release`],
  ['GET', `/aircraft/${AIRCRAFT_ID}/photo`],
  ['PUT', `/aircraft/${AIRCRAFT_ID}/photo`],
  ['DELETE', `/aircraft/${AIRCRAFT_ID}/photo`],
];

test('todas las rutas de aeronaves exigen sesión', async (t) => {
  noDatabase(t);
  for (const [method, path] of SUPER_ADMIN_ROUTES) {
    const res = await request(path, { method, body: ['POST', 'PUT', 'PATCH'].includes(method) ? '{}' : undefined });
    assert.equal(res.status, 401, `${method} ${path}`);
  }
});

test('el supervisor y el tripulante no pueden administrar la flota (403)', async (t) => {
  noDatabase(t);
  for (const role of ['supervisor', 'crew']) {
    for (const [method, path] of SUPER_ADMIN_ROUTES) {
      const res = await request(path, { method, role, body: ['POST', 'PUT', 'PATCH'].includes(method) ? '{}' : undefined });
      assert.equal(res.status, 403, `${role} ${method} ${path}`);
    }
  }
});

test('el catálogo responde al super_admin sin consultar la base', async (t) => {
  noDatabase(t);
  const res = await request('/aircraft/options', { role: 'super_admin' });

  assert.equal(res.status, 200);
  assert.equal(res.body.models[0].name, 'Airbus A321neo');
});

test('registrar con datos inválidos responde 400 antes de consultar la base', async (t) => {
  t.mock.method(console, 'error', () => {});
  noDatabase(t);
  const res = await request('/aircraft', {
    method: 'POST',
    role: 'super_admin',
    body: JSON.stringify({ registration: 'ABC', msn: '10342', model_id: 'a321neo', base: 'ATL' }),
  });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /registration/);
});

test('la foto acepta un body de más de 100 kB y responde 413 por encima de 3 MB', async (t) => {
  t.mock.method(console, 'error', () => {});
  noDatabase(t);

  // ~200 kB con un tipo no permitido: se lee el body (no 413) y responde 400.
  const medium = JSON.stringify({ mime_type: 'image/gif', data_base64: 'A'.repeat(200 * 1024) });
  assert.equal((await request(`/aircraft/${AIRCRAFT_ID}/photo`, { method: 'PUT', role: 'super_admin', body: medium })).status, 400);

  const tooBig = JSON.stringify({ mime_type: 'image/png', data_base64: 'A'.repeat(3 * 1024 * 1024 + 1) });
  assert.equal((await request(`/aircraft/${AIRCRAFT_ID}/photo`, { method: 'PUT', role: 'super_admin', body: tooBig })).status, 413);
  // Sin sesión no lee el body.
  assert.equal((await request(`/aircraft/${AIRCRAFT_ID}/photo`, { method: 'PUT', body: tooBig })).status, 401);
});
