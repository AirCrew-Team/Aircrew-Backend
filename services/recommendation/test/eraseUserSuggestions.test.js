const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const jwt = require('jsonwebtoken');

// Eliminar usuarios (docs/specs/eliminar-usuarios.md, frontend): Admin le pide a
// Recommendation que borre las sugerencias de la IA que nombran al eliminado.
// Ruta interna con token de servicio; repetirla no falla y devuelve 0.

// Antes de cargar la app: dotenv no pisa una variable que ya existe.
process.env.JWT_SECRET = 'secreto-de-prueba';
const app = require('../src/app');
const pool = require('../src/adapters/outbound/persistence/pool');

const CREW_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const PATH = `/internal/users/${CREW_ID}/suggestions`;

function tokenFor(role) {
  return jwt.sign({ role }, 'secreto-de-prueba', {
    subject: role === 'service' ? 'service:admin' : CREW_ID,
    issuer: 'aircrew-admin',
    expiresIn: '1m',
  });
}

function fakeDatabase(t, rowCount = 0) {
  const queries = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    queries.push({ sql, params });
    return { rows: [], rowCount };
  });
  return queries;
}

async function request(path, { role } = {}) {
  const server = app.listen(0);
  await once(server, 'listening');
  try {
    const headers = role ? { Authorization: `Bearer ${tokenFor(role)}` } : {};
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: 'DELETE',
      headers,
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('la ruta interna exige un token de servicio y no consulta la base sin él', async (t) => {
  const queries = fakeDatabase(t);
  assert.equal((await request(PATH)).status, 401);
  for (const role of ['crew', 'supervisor', 'super_admin']) {
    assert.equal((await request(PATH, { role })).status, 403, role);
  }
  assert.equal(queries.length, 0);
});

test('un id inválido responde 400 sin consultar la base', async (t) => {
  const queries = fakeDatabase(t);
  const res = await request('/internal/users/no-es-uuid/suggestions', { role: 'service' });
  assert.equal(res.status, 400);
  assert.equal(queries.length, 0);
});

test('borra las sugerencias que nombran al tripulante y dice cuántas', async (t) => {
  const queries = fakeDatabase(t, 3);

  const res = await request(PATH, { role: 'service' });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { deleted: 3 });
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /DELETE FROM public\.replacement_suggestions\s+WHERE crew_user_id = \$1/);
  assert.deepEqual(queries[0].params, [CREW_ID]);
});

test('es idempotente: un segundo llamado no falla y devuelve 0', async (t) => {
  fakeDatabase(t, 0);
  const res = await request(PATH, { role: 'service' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { deleted: 0 });
});
