const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const jwt = require('jsonwebtoken');

// BE-7: GET /absences/me, las ausencias del propio tripulante. Las de fechas
// llevan sus vuelos (hijas por parent_absence_id); las de un vuelo reportado
// directamente salen solas. El frontend las cruza con Mis Vuelos por flight_id.
process.env.JWT_SECRET = 'secreto-de-prueba';
const app = require('../src/app');
const pool = require('../src/adapters/outbound/persistence/pool');
const absenceRepository = require('../src/adapters/outbound/persistence/repositories/absenceRepository');
const createGetMyAbsences = require('../src/application/use-cases/getMyAbsences');

const CREW_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const OTHER_ID = '11111111-1111-4111-8111-111111111111';
const CREW = { id: CREW_ID, role: 'crew' };
const ATTACHMENT = { file_name: 'incapacidad.pdf', mime_type: 'application/pdf', size_bytes: 4000 };

// Filas como las devuelve el repositorio (absenceWithCrewMember).
function row(fields) {
  return {
    parent_absence_id: null,
    crew_user_id: CREW_ID,
    flight_id: null,
    flight_number: null,
    flight_departure_at: null,
    flight_origin: null,
    flight_destination: null,
    slot_role: null,
    start_date: null,
    end_date: null,
    reason: 'illness',
    notes: null,
    status: 'reported',
    suggestions_state: null,
    replacement_user_id: null,
    approved_by: null,
    approved_at: null,
    deadline_at: null,
    candidate_count: 0,
    replacement_option: null,
    covered_at: null,
    employee_code: 'AC-1108',
    position: 'Comandante',
    rank: 'captain',
    attachment: null,
    ...fields,
  };
}

const DATES = row({
  id: 'd1',
  code: 'SOL-00010',
  kind: 'dates',
  start_date: '2026-07-15',
  end_date: '2026-07-16',
  attachment: ATTACHMENT,
  created_at: '2026-07-10T12:00:00.000Z',
});
const child = (id, flightNumber, departure, fields = {}) =>
  row({
    id,
    code: `SOL-${id}`,
    kind: 'flight',
    parent_absence_id: 'd1',
    flight_id: `f-${id}`,
    flight_number: flightNumber,
    flight_departure_at: departure,
    flight_origin: 'ATL',
    flight_destination: 'JFK',
    slot_role: 'captain',
    suggestions_state: 'ready',
    created_at: '2026-07-10T12:00:01.000Z',
    ...fields,
  });
const LATE_CHILD = child('c2', 'DL202', '2026-07-16T20:00:00.000Z', {
  status: 'pending_ack',
  replacement_user_id: OTHER_ID,
  approved_by: OTHER_ID,
  deadline_at: '2026-07-16T18:00:00.000Z',
});
const EARLY_CHILD = child('c1', 'DL101', '2026-07-15T14:00:00.000Z');
// Reportada directamente sobre un vuelo: sin madre.
const DIRECT = row({
  id: 'v1',
  code: 'SOL-00020',
  kind: 'flight',
  flight_id: 'f-v1',
  flight_number: 'DL303',
  // 23:30 del 1 de agosto en Los Ángeles; ya 2 de agosto en Nueva York.
  flight_departure_at: '2026-08-02T06:30:00.000Z',
  flight_origin: 'LAX',
  flight_destination: 'SEA',
  slot_role: 'captain',
  reason: 'fatigue',
  status: 'covered',
  replacement_user_id: OTHER_ID,
  created_at: '2026-07-20T09:00:00.000Z',
});

function setup({ rows = [DATES, LATE_CHILD, EARLY_CHILD, DIRECT], member = { base: 'ATL' } } = {}) {
  const calls = { findCrewAbsences: [], findCrewMemberByUserId: [] };
  const getMyAbsences = createGetMyAbsences({
    absenceRepository: {
      findCrewAbsences: async (id) => {
        calls.findCrewAbsences.push(id);
        return rows.map((item) => ({ ...item }));
      },
    },
    findCrewMemberByUserId: async (id) => {
      calls.findCrewMemberByUserId.push(id);
      return member;
    },
  });
  return { getMyAbsences, calls };
}

// ------------------------------------------------------------- caso de uso

test('agrupa los vuelos bajo su ausencia por fechas, la más reciente primero', async () => {
  const { getMyAbsences, calls } = setup();

  const absences = await getMyAbsences(CREW);

  assert.deepEqual(calls.findCrewAbsences, [CREW_ID]);
  assert.deepEqual(absences.map((item) => item.id), ['v1', 'd1']);
  assert.deepEqual(absences[1], {
    id: 'd1',
    code: 'SOL-00010',
    kind: 'dates',
    reason: 'illness',
    notes: null,
    status: 'reported',
    start_date: '2026-07-15',
    end_date: '2026-07-16',
    flight_id: null,
    flight_number: null,
    origin: null,
    destination: null,
    departure_at: null,
    slot_role: null,
    attachment: ATTACHMENT,
    created_at: '2026-07-10T12:00:00.000Z',
    flights: [
      {
        id: 'c1',
        code: 'SOL-c1',
        flight_id: 'f-c1',
        flight_number: 'DL101',
        origin: 'ATL',
        destination: 'JFK',
        departure_at: '2026-07-15T14:00:00.000Z',
        slot_role: 'captain',
        status: 'reported',
      },
      {
        id: 'c2',
        code: 'SOL-c2',
        flight_id: 'f-c2',
        flight_number: 'DL202',
        origin: 'ATL',
        destination: 'JFK',
        departure_at: '2026-07-16T20:00:00.000Z',
        slot_role: 'captain',
        status: 'pending_ack',
      },
    ],
  });
});

test('la ausencia de un vuelo reportado directamente sale sola, con su vuelo', async () => {
  const { getMyAbsences } = setup();

  const [direct] = await getMyAbsences(CREW);

  assert.equal(direct.kind, 'flight');
  assert.equal(direct.status, 'covered');
  assert.equal(direct.flight_id, 'f-v1');
  assert.equal(direct.flight_number, 'DL303');
  assert.equal(direct.origin, 'LAX');
  assert.equal(direct.destination, 'SEA');
  assert.equal(direct.departure_at, '2026-08-02T06:30:00.000Z');
  assert.deepEqual(direct.flights, []);
});

test('no expone datos de otros: ni el reemplazo, ni quién aprobó, ni sus plazos', async () => {
  const { getMyAbsences } = setup();
  const text = JSON.stringify(await getMyAbsences(CREW));

  assert.equal(text.includes(OTHER_ID), false);
  for (const field of ['replacement_user_id', 'approved_by', 'deadline_at', 'crew_user_id', 'candidate_count']) {
    assert.equal(text.includes(`"${field}"`), false, field);
  }
});

test('from y to: las de fechas que se cruzan y las de vuelo por el día local de su base; las hijas van con su madre', async () => {
  const lax = setup({ member: { base: 'LAX' } });
  const august = await lax.getMyAbsences(CREW, { from: '2026-08-01', to: '2026-08-01' });
  assert.deepEqual(lax.calls.findCrewMemberByUserId, [CREW_ID]);
  assert.deepEqual(august.map((item) => item.id), ['v1']); // 1 de agosto en Los Ángeles

  const jfk = setup({ member: { base: 'JFK' } });
  assert.deepEqual((await jfk.getMyAbsences(CREW, { from: '2026-08-01', to: '2026-08-01' })).length, 0);

  const july = await setup().getMyAbsences(CREW, { from: '2026-07-16', to: '2026-07-31' });
  assert.deepEqual(july.map((item) => item.id), ['d1']);
  assert.equal(july[0].flights.length, 2);

  assert.deepEqual((await setup().getMyAbsences(CREW, { from: '2026-07-17' })).map((item) => item.id), ['v1']);
  assert.deepEqual((await setup().getMyAbsences(CREW, { to: '2026-07-14' })).length, 0);
});

test('sin filtro no consulta el perfil', async () => {
  const { getMyAbsences, calls } = setup();
  await getMyAbsences(CREW, {});
  assert.deepEqual(calls.findCrewMemberByUserId, []);
});

test('from y to inválidos responden 400 sin consultar la base', async () => {
  const { getMyAbsences, calls } = setup();
  await assert.rejects(getMyAbsences(CREW, { from: '2026-02-30' }), { status: 400, field: 'from' });
  await assert.rejects(getMyAbsences(CREW, { to: 'ayer' }), { status: 400, field: 'to' });
  await assert.rejects(getMyAbsences(CREW, { from: '2026-08-02', to: '2026-08-01' }), { status: 400, field: 'to' });
  assert.deepEqual(calls.findCrewAbsences, []);
});

test('el repositorio filtra por el tripulante y nunca trae los bytes del comprobante', async (t) => {
  const queries = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    queries.push({ sql, params });
    return { rows: [] };
  });

  await absenceRepository.findCrewAbsences(CREW_ID);

  assert.deepEqual(queries[0].params, [CREW_ID]);
  assert.match(queries[0].sql, /WHERE a\.crew_user_id = \$1/);
  assert.doesNotMatch(queries[0].sql, /att\.data/);
});

// -------------------------------------------------------------------- HTTP

function tokenFor(role) {
  return jwt.sign({ role }, 'secreto-de-prueba', { subject: CREW_ID, issuer: 'aircrew-admin', expiresIn: '1h' });
}

async function request(path, { role } = {}) {
  const server = app.listen(0);
  await once(server, 'listening');
  try {
    const headers = role ? { Authorization: `Bearer ${tokenFor(role)}` } : {};
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { headers });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

function mockQuery(t, rows) {
  const queries = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    queries.push({ sql, params });
    return { rows };
  });
  return queries;
}

test('GET /absences/me exige sesión', async (t) => {
  mockQuery(t, []);
  assert.equal((await request('/absences/me')).status, 401);
});

test('GET /absences/me: el supervisor, el super_admin y un servicio reciben 403', async (t) => {
  const queries = mockQuery(t, []);
  for (const role of ['supervisor', 'super_admin', 'service']) {
    assert.equal((await request('/absences/me', { role })).status, 403, role);
  }
  assert.equal(queries.length, 0);
});

test('GET /absences/me: el tripulante recibe las suyas, aunque pida otro crew_user_id', async (t) => {
  const queries = mockQuery(t, [DATES, EARLY_CHILD]);

  const res = await request(`/absences/me?crew_user_id=${OTHER_ID}`, { role: 'crew' });

  assert.equal(res.status, 200);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].params, [CREW_ID]);
  assert.deepEqual(res.body.map((item) => item.id), ['d1']);
  assert.deepEqual(res.body[0].flights.map((item) => item.flight_id), ['f-c1']);
});

test('GET /absences/me con una fecha inválida responde 400 antes de consultar la base', async (t) => {
  t.mock.method(console, 'error', () => {});
  const queries = mockQuery(t, []);
  const res = await request('/absences/me?from=15-07-2026', { role: 'crew' });
  assert.equal(res.status, 400);
  assert.equal(queries.length, 0);
});
