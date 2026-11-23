const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const jwt = require('jsonwebtoken');

// BE-7: GET /shifts/current sin base es el resumen de todas las bases juntas
// (Inicio del super_admin, «guardia»), con base null y la hora de Nueva York.
// El supervisor sin base recibe lo mismo: es el comportamiento que ya había.
process.env.JWT_SECRET = 'secreto-de-prueba';
const app = require('../src/app');
const createShiftOverview = require('../src/application/use-cases/shiftOverview');

// 2026-07-16 05:00Z: 01:00 del 16 en Nueva York (noche), 22:00 del 15 en Los Ángeles.
const NOW = Date.parse('2026-07-16T05:00:00Z');

const member = (userId, base, status) => ({
  user_id: userId,
  employee_code: userId.toUpperCase(),
  position: 'Comandante',
  rank: 'captain',
  base,
  base_code: base,
  status,
  is_active: true,
  medical_expires_on: null,
});

const MEMBERS = [
  member('atl-1', 'ATL', 'on_duty'),
  member('lax-1', 'LAX', 'on_duty'),
  member('lax-2', 'LAX', 'available'),
];
const FLIGHTS = [{ origin: 'ATL' }, { origin: 'LAX' }, { origin: 'SEA' }];

function setup() {
  const calls = { listFlights: [] };
  const overview = createShiftOverview({
    findCrewMembers: async () => MEMBERS,
    absenceRepository: { findOpenAbsences: async () => [] },
    attachUserNames: async (rows) => rows,
    flightsClient: {
      getAssignments: async () => [],
      listFlights: async (range) => {
        calls.listFlights.push(range);
        return FLIGHTS;
      },
    },
    now: () => NOW,
  });
  return { overview, calls };
}

test('sin base: todas las bases juntas, base null y el día y el turno de Nueva York', async () => {
  const { overview, calls } = setup();

  const shift = await overview.getCurrentShift({}, 'Bearer admin');

  assert.deepEqual(shift, {
    shift: 'night',
    base: null,
    flights_today: 3,
    standby_total: 2,
    standby_ready: 2,
    staffing_delays: 0,
  });
  assert.deepEqual(calls.listFlights[0], { from: '2026-07-16T04:00:00.000Z', to: '2026-07-17T04:00:00.000Z' });
});

test('con base solo cuenta esa base (los mismos campos)', async () => {
  const { overview } = setup();

  const shift = await overview.getCurrentShift({ base: 'LAX' }, 'Bearer sup');

  assert.equal(shift.base, 'LAX');
  assert.equal(shift.shift, 'night'); // 22:00 en Los Ángeles (turno 22–06)
  assert.equal(shift.flights_today, 1);
  assert.equal(shift.standby_total, 1);
});

function tokenFor(role) {
  return jwt.sign({ role }, 'secreto-de-prueba', {
    subject: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
    issuer: 'aircrew-admin',
    expiresIn: '1h',
  });
}

async function request(path, { role } = {}) {
  const server = app.listen(0);
  await once(server, 'listening');
  try {
    const headers = role ? { Authorization: `Bearer ${tokenFor(role)}` } : {};
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { headers });
    return { status: response.status, body: await response.json() };
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('GET /shifts/current exige sesión; el tripulante y un servicio reciben 403', async () => {
  assert.equal((await request('/shifts/current')).status, 401);
  for (const role of ['crew', 'service']) {
    assert.equal((await request('/shifts/current', { role })).status, 403, role);
  }
});

// Una base inválida falla antes de llamar a Flights: prueba que el rol pasó.
test('GET /shifts/current: el supervisor y el super_admin pasan el control de rol', async (t) => {
  t.mock.method(console, 'error', () => {});
  for (const role of ['supervisor', 'super_admin']) {
    const res = await request('/shifts/current?base=bogota', { role });
    assert.equal(res.status, 400, role);
    assert.equal(res.body.field, 'base');
  }
});
