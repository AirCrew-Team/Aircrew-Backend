const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const jwt = require('jsonwebtoken');

// Eliminar usuarios (docs/specs/eliminar-usuarios.md, frontend): Admin le pide a
// Crew que borre todo lo del tripulante eliminado: perfil, certificaciones (con su
// archivo y su historial) y ausencias (con sus hijas, comprobantes y eventos).
// Ruta interna con x-service-key; repetirla no falla y devuelve 0.
// El SQL real se probó con el Postgres desechable.

// Antes de cargar src: config/env lee las variables con el primer require.
process.env.JWT_SECRET = 'secreto-de-prueba';
process.env.ADMIN_SERVICE_KEY = 'clave-de-admin';
const app = require('../src/app');
const pool = require('../src/adapters/outbound/persistence/pool');

const CREW_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const PATH = `/internal/users/${CREW_ID}`;
const KEY = { 'x-service-key': 'clave-de-admin' };

function noDatabase(t) {
  t.mock.method(pool, 'query', async (sql) => {
    throw new Error(`Consulta inesperada en el test: ${sql}`);
  });
  t.mock.method(pool, 'connect', async () => {
    throw new Error('Conexión inesperada en el test.');
  });
}

// Cliente de la transacción: anota cada consulta y responde con rowCount según el SQL.
function fakeClient(t, { counts = {}, failOn = null } = {}) {
  const queries = [];
  const client = {
    released: false,
    async query(sql, params) {
      queries.push({ sql: sql.trim(), params });
      if (failOn && sql.includes(failOn)) throw new Error('falla simulada');
      const match = Object.keys(counts).find((key) => sql.includes(key));
      return { rows: [], rowCount: match ? counts[match] : 0 };
    },
    release() {
      client.released = true;
    },
  };
  t.mock.method(pool, 'query', async (sql) => {
    throw new Error(`Consulta fuera de la transacción: ${sql}`);
  });
  t.mock.method(pool, 'connect', async () => client);
  return { client, queries };
}

async function request(path, { headers = {} } = {}) {
  const server = app.listen(0);
  await once(server, 'listening');
  try {
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

test('la ruta interna exige la clave de Admin, no una sesión', async (t) => {
  noDatabase(t);
  const superAdminToken = jwt.sign({ role: 'super_admin' }, 'secreto-de-prueba', {
    subject: CREW_ID,
    issuer: 'aircrew-admin',
    expiresIn: '1h',
  });
  for (const headers of [{}, { Authorization: `Bearer ${superAdminToken}` }, { 'x-service-key': 'otra' }]) {
    assert.equal((await request(PATH, { headers })).status, 401, JSON.stringify(headers));
  }
});

test('un id inválido responde 400 sin consultar la base', async (t) => {
  noDatabase(t);
  t.mock.method(console, 'error', () => {});
  const res = await request('/internal/users/no-es-uuid', { headers: KEY });
  assert.equal(res.status, 400);
});

test('borra ausencias, certificación y perfil en una transacción y dice cuántos', async (t) => {
  const { client, queries } = fakeClient(t, {
    counts: {
      'DELETE FROM public.absences': 3,
      'DELETE FROM public.crew_certifications': 1,
      'DELETE FROM public.crew_members': 1,
    },
  });

  const res = await request(PATH, { headers: KEY });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { profile: 1, certifications: 1, absences: 3, reopened_absences: 0 });
  assert.equal(queries[0].sql, 'BEGIN');
  assert.equal(queries.at(-1).sql, 'COMMIT');
  const order = queries.map((q) => q.sql);
  const at = (text) => order.findIndex((sql) => sql.includes(text));
  // Las certificaciones cuelgan del perfil: se cuentan antes de borrarlo.
  assert.ok(at('DELETE FROM public.absences') < at('DELETE FROM public.crew_members'));
  assert.ok(at('DELETE FROM public.crew_certifications') < at('DELETE FROM public.crew_members'));
  for (const q of queries.slice(1, -1)) assert.deepEqual(q.params, [CREW_ID]);
  assert.equal(client.released, true);
});

test('una ausencia de otro que esperaba su «Enterado» vuelve a la cola', async (t) => {
  const { queries } = fakeClient(t, { counts: { "status = 'pending_ack'": 1 } });

  const res = await request(PATH, { headers: KEY });

  assert.equal(res.body.reopened_absences, 1);
  const reopen = queries.find((q) => q.sql.includes("status = 'pending_ack'"));
  assert.match(reopen.sql, /SET status = 'reported', replacement_user_id = NULL/);
  assert.match(reopen.sql, /WHERE replacement_user_id = \$1 AND status = 'pending_ack'/);
  assert.match(reopen.sql, /INSERT INTO public\.absence_events/);
});

test('es idempotente: un segundo llamado no falla y devuelve 0', async (t) => {
  fakeClient(t);
  const res = await request(PATH, { headers: KEY });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { profile: 0, certifications: 0, absences: 0, reopened_absences: 0 });
});

test('si una consulta falla, se deshace todo (ROLLBACK)', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { client, queries } = fakeClient(t, { failOn: 'DELETE FROM public.crew_members' });

  const res = await request(PATH, { headers: KEY });

  assert.equal(res.status, 500);
  assert.equal(queries.at(-1).sql, 'ROLLBACK');
  assert.equal(client.released, true);
});
