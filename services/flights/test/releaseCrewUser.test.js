const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const jwt = require('jsonwebtoken');

// Eliminar usuarios (docs/specs/eliminar-usuarios.md, frontend): Admin le pide a
// Flights que libere las asignaciones del tripulante eliminado. Las de vuelos que aún
// no salen dejan el puesto vacante y se devuelven; las pasadas solo se borran.
// Ruta interna con token de servicio. El SQL real se probó con el Postgres desechable.

// Antes de cargar la app: dotenv no pisa una variable que ya existe.
process.env.JWT_SECRET = 'secreto-de-prueba';
const app = require('../src/app');
const pool = require('../src/adapters/outbound/persistence/pool');

const CREW_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const FUTURE_FLIGHT = '11111111-1111-4111-8111-111111111111';
const PAST_FLIGHT = '22222222-2222-4222-8222-222222222222';
const COVER_FLIGHT = '33333333-3333-4333-8333-333333333333';
const PATH = `/internal/users/${CREW_ID}/assignments`;

function tokenFor(role) {
  return jwt.sign({ role }, 'secreto-de-prueba', {
    subject: role === 'service' ? 'service:admin' : CREW_ID,
    issuer: 'aircrew-admin',
    expiresIn: '1m',
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

// Cliente de la transacción: anota cada consulta y responde según el SQL.
function fakeClient(t, { deleted = [], restored = null, failOn = null } = {}) {
  const queries = [];
  const client = {
    released: false,
    async query(sql, params) {
      queries.push({ sql: sql.trim(), params });
      if (failOn && sql.includes(failOn)) throw new Error('falla simulada');
      if (/DELETE FROM public\.flight_assignments/.test(sql)) return { rows: deleted };
      if (/SET status = 'assigned'/.test(sql)) return { rows: restored ? [restored] : [] };
      return { rows: [] };
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

function row(overrides) {
  return {
    flight_id: FUTURE_FLIGHT,
    slot_id: 'fa-1',
    role: 'flight_attendant',
    status: 'assigned',
    is_replacement: false,
    acknowledged_at: null,
    flight_number: 'DL1102',
    origin: 'JFK',
    destination: 'LAX',
    departure_at: new Date('2026-12-01T15:00:00Z'),
    upcoming: true,
    ...overrides,
  };
}

async function request(path, { method = 'DELETE', role } = {}) {
  const server = app.listen(0);
  await once(server, 'listening');
  try {
    const headers = role ? { Authorization: `Bearer ${tokenFor(role)}` } : {};
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('la ruta interna exige un token de servicio', async (t) => {
  noDatabase(t);
  assert.equal((await request(PATH)).status, 401);
  for (const role of ['crew', 'supervisor', 'super_admin']) {
    assert.equal((await request(PATH, { role })).status, 403, role);
  }
});

test('un id inválido responde 400 sin consultar la base', async (t) => {
  noDatabase(t);
  const res = await request('/internal/users/no-es-uuid/assignments', { role: 'service' });
  assert.equal(res.status, 400);
});

test('libera todo: el vuelo futuro queda vacante y se devuelve; el pasado solo se borra', async (t) => {
  const { client, queries } = fakeClient(t, {
    deleted: [row(), row({ flight_id: PAST_FLIGHT, flight_number: 'DL0900', upcoming: false })],
  });

  const res = await request(PATH, { role: 'service' });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    deleted: 2,
    restored: 0,
    vacated_flights: [
      {
        flight_id: FUTURE_FLIGHT,
        flight_number: 'DL1102',
        origin: 'JFK',
        destination: 'LAX',
        departure_at: '2026-12-01T15:00:00.000Z',
        slot_id: 'fa-1',
        role: 'flight_attendant',
      },
    ],
  });
  assert.equal(queries[0].sql, 'BEGIN');
  assert.equal(queries.at(-1).sql, 'COMMIT');
  assert.deepEqual(queries[1].params, [CREW_ID]);
  assert.equal(client.released, true);
});

test('un vuelo futuro con la tripulación confirmada vuelve a quedar sin confirmar', async (t) => {
  const { queries } = fakeClient(t, { deleted: [row()] });

  await request(PATH, { role: 'service' });

  const unconfirm = queries.find((q) => /crew_confirmed_at = NULL/.test(q.sql));
  assert.ok(unconfirm, 'falta quitar la confirmación');
  assert.deepEqual(unconfirm.params, [[FUTURE_FLIGHT]]);
  // Quién la había confirmado se conserva (spec: fuera de alcance borrar a los aprobadores).
  assert.doesNotMatch(unconfirm.sql, /crew_confirmed_by/);
});

test('un puesto ya reemplazado o un vuelo cancelado no cuentan como vacante', async (t) => {
  const { queries } = fakeClient(t, {
    deleted: [row({ status: 'replaced' }), row({ flight_id: PAST_FLIGHT, upcoming: false })],
  });

  const res = await request(PATH, { role: 'service' });

  assert.deepEqual(res.body, { deleted: 2, restored: 0, vacated_flights: [] });
  assert.equal(queries.some((q) => /crew_confirmed_at = NULL/.test(q.sql)), false);
});

test('si era un reemplazo sin «Enterado», el puesto vuelve a quien había reemplazado', async (t) => {
  const { queries } = fakeClient(t, {
    deleted: [row({ flight_id: COVER_FLIGHT, is_replacement: true })],
    restored: { id: '44444444-4444-4444-8444-444444444444' },
  });

  const res = await request(PATH, { role: 'service' });

  assert.deepEqual(res.body, { deleted: 1, restored: 1, vacated_flights: [] });
  const restore = queries.find((q) => /SET status = 'assigned'/.test(q.sql));
  assert.deepEqual(restore.params, [COVER_FLIGHT, 'fa-1', 'flight_attendant']);
});

test('si no hay a quién devolver el puesto del reemplazo, queda vacante', async (t) => {
  fakeClient(t, { deleted: [row({ is_replacement: true })], restored: null });

  const res = await request(PATH, { role: 'service' });

  assert.equal(res.body.restored, 0);
  assert.equal(res.body.vacated_flights.length, 1);
});

test('un reemplazo que ya dio «Enterado» deja el puesto vacante', async (t) => {
  fakeClient(t, { deleted: [row({ is_replacement: true, acknowledged_at: new Date() })] });

  const res = await request(PATH, { role: 'service' });

  assert.equal(res.body.restored, 0);
  assert.equal(res.body.vacated_flights.length, 1);
});

test('es idempotente: un segundo llamado no falla y devuelve 0', async (t) => {
  const { queries } = fakeClient(t, { deleted: [] });

  const res = await request(PATH, { role: 'service' });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { deleted: 0, restored: 0, vacated_flights: [] });
  assert.equal(queries.at(-1).sql, 'COMMIT');
});

test('si una consulta falla, se deshace todo (ROLLBACK) y responde 500', async (t) => {
  const { client, queries } = fakeClient(t, { deleted: [row()], failOn: 'crew_confirmed_at = NULL' });

  const res = await request(PATH, { role: 'service' });

  assert.equal(res.status, 500);
  assert.equal(queries.at(-1).sql, 'ROLLBACK');
  assert.equal(client.released, true);
});
