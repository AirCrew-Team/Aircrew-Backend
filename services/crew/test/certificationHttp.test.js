const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const jwt = require('jsonwebtoken');

// Antes de cargar la app: dotenv no pisa una variable que ya existe.
process.env.JWT_SECRET = 'secreto-de-prueba';
const app = require('../src/app');
const pool = require('../src/adapters/outbound/persistence/pool');

// Ningún caso llega a PostgreSQL: terminan antes (sesión, rol, datos o tamaño).
const CREW_USER_ID = '11111111-1111-4111-8111-111111111111';

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

const ROUTES = [
  ['GET', '/certifications'],
  ['GET', '/certifications/stats'],
  ['GET', '/certifications/options'],
  ['GET', '/certifications/uncertified'],
  ['GET', `/certifications/${CREW_USER_ID}`],
  ['GET', `/certifications/${CREW_USER_ID}/file`],
  ['PUT', `/certifications/${CREW_USER_ID}`],
  ['DELETE', `/certifications/${CREW_USER_ID}`],
];

test('todas las rutas de certificaciones exigen sesión', async (t) => {
  noDatabase(t);
  for (const [method, path] of ROUTES) {
    const res = await request(path, { method, body: method === 'PUT' ? '{}' : undefined });
    assert.equal(res.status, 401, `${method} ${path}`);
  }
});

test('solo el super_admin: el supervisor y el tripulante reciben 403', async (t) => {
  noDatabase(t);
  for (const role of ['supervisor', 'crew']) {
    for (const [method, path] of ROUTES) {
      const res = await request(path, { method, role, body: method === 'PUT' ? '{}' : undefined });
      assert.equal(res.status, 403, `${role} ${method} ${path}`);
    }
  }
});

test('el catálogo responde al super_admin sin consultar la base', async (t) => {
  noDatabase(t);
  const res = await request('/certifications/options', { role: 'super_admin' });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.by_position['Auxiliar de Vuelo'].certificates, ['CDP']);
  assert.equal(res.body.certificates.find((item) => item.code === 'ATP').name, 'Airline Transport Pilot (ATP)');
});

test('un filtro inválido responde 400 antes de consultar la base', async (t) => {
  t.mock.method(console, 'error', () => {});
  noDatabase(t);
  const res = await request('/certifications?status=verificado', { role: 'super_admin' });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /status debe ser uno de/);
});

test('PUT: sin sesión no lee el body; con super_admin, más de 8 MB es 413', async (t) => {
  t.mock.method(console, 'error', () => {});
  noDatabase(t);
  const tooBig = JSON.stringify({ license_number: 'a'.repeat(8 * 1024 * 1024 + 1) });

  assert.equal((await request(`/certifications/${CREW_USER_ID}`, { method: 'PUT', body: tooBig })).status, 401);
  assert.equal((await request(`/certifications/${CREW_USER_ID}`, { method: 'PUT', role: 'super_admin', body: tooBig })).status, 413);
});

test('las demás rutas de crew mantienen el límite de 100 kB', async (t) => {
  t.mock.method(console, 'error', () => {});
  noDatabase(t);
  const body = JSON.stringify({ replacement_user_id: 'x'.repeat(200 * 1024) });

  const res = await request(`/absences/${CREW_USER_ID}/cover`, { method: 'PATCH', role: 'supervisor', body });
  assert.equal(res.status, 413);
});
