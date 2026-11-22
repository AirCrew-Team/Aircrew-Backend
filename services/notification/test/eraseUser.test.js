const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const jwt = require('jsonwebtoken');

// Eliminar usuarios (docs/specs/eliminar-usuarios.md, frontend). Al eliminar a un
// tripulante, Admin publica a los supervisores una alerta «puesto vacante» por cada
// vuelo futuro afectado y después borra las notificaciones de la persona. Las dos
// rutas son internas, con token de servicio.

// Antes de cargar src: config/env fija JWT_SECRET con el primer require.
process.env.JWT_SECRET = 'secreto-de-prueba';
const app = require('../src/app');
const pool = require('../src/adapters/outbound/persistence/pool');
const ssePublisher = require('../src/adapters/outbound/publishers/ssePublisher');
const {
  ALERT_EVENTS,
  createSlotVacatedAlert,
  disabledAlertTypes,
} = require('../src/domain/alerts');

const CREW_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const FLIGHT_ID = '11111111-1111-4111-8111-111111111111';
const SAVED_ID = '99999999-9999-4999-8999-999999999999';

const VACATED = {
  flight_id: FLIGHT_ID,
  flight_number: 'DL1102',
  origin: 'JFK',
  destination: 'LAX',
  departure_at: '2026-12-01T15:00:00.000Z',
  slot_id: 'fa-1',
  role: 'flight_attendant',
};

function tokenFor(role) {
  return jwt.sign({ role }, 'secreto-de-prueba', {
    subject: role === 'service' ? 'service:admin' : CREW_ID,
    issuer: 'aircrew-admin',
    expiresIn: '1m',
  });
}

function fakeDatabase(t, respond = () => ({ rows: [] })) {
  const queries = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    queries.push({ sql, params });
    return respond(sql, params);
  });
  return queries;
}

async function request(path, { method, role, body } = {}) {
  const server = app.listen(0);
  await once(server, 'listening');
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (role) headers.Authorization = `Bearer ${tokenFor(role)}`;
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers,
      body: body && JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

// ------------------------------------------------------------- la alerta

test('la alerta «puesto vacante» nombra el vuelo y la ruta', () => {
  const alert = createSlotVacatedAlert(VACATED);

  assert.equal(alert.type, 'flight:slot_vacated');
  assert.equal(alert.type, ALERT_EVENTS.slotVacated);
  assert.equal(
    alert.message,
    'Puesto vacante en DL1102 (JFK → LAX): se eliminó la cuenta del tripulante.'
  );
  assert.equal(alert.flight_id, FLIGHT_ID);
  assert.equal(alert.slot_id, 'fa-1');
  assert.equal(alert.role, 'flight_attendant');
  assert.equal(alert.departure_at, VACATED.departure_at);
});

test('sin origen ni destino, la alerta solo nombra el vuelo', () => {
  const alert = createSlotVacatedAlert({ flight_id: FLIGHT_ID, flight_number: 'DL1102' });
  assert.equal(alert.message, 'Puesto vacante en DL1102: se eliminó la cuenta del tripulante.');
});

test('la alerta exige flight_id y flight_number', () => {
  assert.throws(() => createSlotVacatedAlert({ flight_number: 'DL1102' }), { status: 400 });
  assert.throws(() => createSlotVacatedAlert({ flight_id: FLIGHT_ID }), { status: 400 });
  assert.throws(() => createSlotVacatedAlert(null), { status: 400 });
});

test('BE-6: «puesto vacante» no tiene preferencia, así que nunca se apaga', () => {
  const allOff = { absence_reported: false, absence_covered: false, replacement_assigned: false };
  assert.equal(disabledAlertTypes(allOff).includes(ALERT_EVENTS.slotVacated), false);
});

// ------------------------------------------------------------ publicar

test('las rutas internas exigen un token de servicio', async (t) => {
  const queries = fakeDatabase(t);
  const routes = [
    ['POST', '/internal/alerts/slot-vacated'],
    ['DELETE', `/internal/users/${CREW_ID}/notifications`],
  ];
  for (const [method, path] of routes) {
    assert.equal((await request(path, { method, body: VACATED })).status, 401, path);
    for (const role of ['crew', 'supervisor', 'super_admin']) {
      assert.equal((await request(path, { method, role, body: VACATED })).status, 403, `${role} ${path}`);
    }
  }
  assert.equal(queries.length, 0);
});

test('publicar: se guarda una vez para los supervisores y sale en vivo', async (t) => {
  const queries = fakeDatabase(t, () => ({
    rows: [{ id: SAVED_ID, created_at: '2026-11-22T10:00:00.000Z' }],
  }));
  const published = [];
  t.mock.method(ssePublisher, 'publishToSupervisors', (alert) => {
    published.push(alert);
    return 2;
  });

  const res = await request('/internal/alerts/slot-vacated', {
    method: 'POST',
    role: 'service',
    body: VACATED,
  });

  assert.equal(res.status, 202);
  assert.equal(res.body.type, 'flight:slot_vacated');
  assert.equal(res.body.delivered_to, 2);
  assert.equal(res.body.saved, true);
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /INSERT INTO public\.notifications/);
  assert.equal(queries[0].params[0], null);
  assert.equal(queries[0].params[1], 'supervisor');
  assert.equal(queries[0].params[2], 'flight:slot_vacated');
  assert.equal(published[0].id, SAVED_ID);
  assert.equal(published[0].flight_number, 'DL1102');
});

test('publicar sin datos del vuelo responde 400', async (t) => {
  fakeDatabase(t);
  const res = await request('/internal/alerts/slot-vacated', {
    method: 'POST',
    role: 'service',
    body: { flight_number: 'DL1102' },
  });
  assert.equal(res.status, 400);
});

// --------------------------------------------------------------- borrar

test('borrar: sus avisos y sus lecturas de alertas, con cuántos de cada uno', async (t) => {
  const queries = fakeDatabase(t, () => ({ rows: [{ notifications: 4, reads: 7 }] }));

  const res = await request(`/internal/users/${CREW_ID}/notifications`, {
    method: 'DELETE',
    role: 'service',
  });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { deleted: 4, reads_deleted: 7 });
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /DELETE FROM public\.notification_reads\s+WHERE user_id = \$1/);
  assert.match(queries[0].sql, /DELETE FROM public\.notifications\s+WHERE user_id = \$1/);
  assert.deepEqual(queries[0].params, [CREW_ID]);
});

test('borrar es idempotente: un segundo llamado devuelve 0', async (t) => {
  fakeDatabase(t, () => ({ rows: [{ notifications: 0, reads: 0 }] }));
  const res = await request(`/internal/users/${CREW_ID}/notifications`, {
    method: 'DELETE',
    role: 'service',
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { deleted: 0, reads_deleted: 0 });
});

test('borrar con un id inválido responde 400 sin consultar la base', async (t) => {
  const queries = fakeDatabase(t);
  const res = await request('/internal/users/no-es-uuid/notifications', {
    method: 'DELETE',
    role: 'service',
  });
  assert.equal(res.status, 400);
  assert.equal(queries.length, 0);
});
