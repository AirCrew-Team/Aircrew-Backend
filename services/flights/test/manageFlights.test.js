const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const jwt = require('jsonwebtoken');

// Antes de cargar la app: dotenv no pisa una variable que ya existe.
process.env.JWT_SECRET = 'secreto-de-prueba';
const app = require('../src/app');
const pool = require('../src/adapters/outbound/persistence/pool');
const { createManageFlights } = require('../src/application/use-cases/manageFlights');
const { AIRCRAFT_MODELS } = require('../src/domain/aircraftCatalog');
const { validateAircraftInput } = require('../src/domain/entities/aircraft');

// Pantalla Vuelos del super_admin: catálogo, lista paginada, indicadores y permisos.
// El servicio monta los vuelos en /flights (el gateway agrega /api/flights delante).

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

function noDatabase(t) {
  t.mock.method(pool, 'query', async (sql) => {
    throw new Error(`Consulta inesperada en el test: ${sql}`);
  });
}

test('/flights/options: el tripulante recibe 403 y sin sesión 401', async (t) => {
  noDatabase(t);
  assert.equal((await request('/flights/options')).status, 401);
  assert.equal((await request('/flights/options', { role: 'crew' })).status, 403);
});

test('/flights/manage, /flights/stats y /flights/options: solo el super_admin (el supervisor recibe 403)', async (t) => {
  noDatabase(t);
  for (const path of ['/flights/manage', '/flights/stats', '/flights/options']) {
    assert.equal((await request(path, { role: 'supervisor' })).status, 403, path);
    assert.equal((await request(path, { role: 'crew' })).status, 403, path);
  }
});

test('/flights/manage: un status desconocido es 400 antes de consultar la base', async (t) => {
  noDatabase(t);
  const response = await request('/flights/manage?status=boarding', { role: 'super_admin' });
  assert.equal(response.status, 400);
  assert.equal(response.body.field, 'status');
});

test('getOptions: is_base sale de los hubs de Delta, solo aeronaves operativas y los 5 estados', async () => {
  const manage = createManageFlights({
    flightRepository: {
      findAllAirports: async () => [
        { code: 'ATL', icao: 'KATL', city: 'Atlanta', name: 'Hartsfield-Jackson', country: 'US', timezone: 'America/New_York', latitude: 33.6407, longitude: -84.4277 },
        // Un NUMERIC llega como texto desde pg: se convierte a número.
        { code: 'LHR', icao: 'EGLL', city: 'Londres', name: 'London Heathrow', country: 'GB', timezone: 'Europe/London', latitude: '51.47', longitude: '-0.4543' },
        // Sin coordenadas (aeropuerto agregado a mano): null.
        { code: 'MCO', icao: 'KMCO', city: 'Orlando', name: 'Orlando International', country: 'US', timezone: 'America/New_York', latitude: null, longitude: null },
      ],
    },
    aircraftRepository: {
      findOperatingAircraft: async () => [
        { id: 'a1', registration: 'N391DN', name: 'Airbus A321neo', family: 'A320', capacity: 194, base: 'ATL', msn: 'x' },
        { id: 'a2', registration: 'N122DU', name: 'Airbus A220-300', family: null, capacity: 130, base: 'BOS' },
      ],
    },
    assignmentRepository: {},
  });

  const options = await manage.getOptions();

  assert.deepEqual(
    options.airports.map(({ code, is_base: isBase, timezone, latitude, longitude }) => [
      code,
      isBase,
      timezone,
      latitude,
      longitude,
    ]),
    [
      ['ATL', true, 'America/New_York', 33.6407, -84.4277],
      ['LHR', false, 'Europe/London', 51.47, -0.4543],
      ['MCO', false, 'America/New_York', null, null],
    ]
  );
  assert.deepEqual(Object.keys(options.airports[0]), [
    'code',
    'icao',
    'city',
    'name',
    'country',
    'timezone',
    'is_base',
    'latitude',
    'longitude',
  ]);
  // Solo los campos del contrato (sin msn ni otros datos de la aeronave).
  assert.deepEqual(options.aircraft[0], {
    id: 'a1',
    registration: 'N391DN',
    name: 'Airbus A321neo',
    family: 'A320',
    capacity: 194,
    base: 'ATL',
  });
  assert.equal(options.aircraft[1].family, null);
  assert.deepEqual(
    options.statuses.map((status) => status.code),
    ['scheduled', 'delayed', 'in_flight', 'completed', 'cancelled']
  );
  assert.equal(options.statuses[0].label, 'Programado');
});

test('listFlights: pasa la búsqueda normalizada, el filtro, la página y las fechas a la base', async () => {
  let received;
  const manage = createManageFlights({
    flightRepository: {
      findFlightsPage: async (params) => {
        received = params;
        return { rows: [], total: 12 };
      },
    },
    aircraftRepository: {},
    assignmentRepository: { findActiveByFlights: async () => [] },
  });

  const page = await manage.listFlights({
    page: '3',
    page_size: '5',
    search: ' Cancún ',
    status: 'scheduled',
    from: '2026-11-24',
  });

  assert.deepEqual(received, {
    search: 'cancun',
    status: 'scheduled',
    from: '2026-11-24T00:00:00.000Z',
    to: null,
    limit: 5,
    offset: 10,
  });
  assert.deepEqual(page, { items: [], page: 3, page_size: 5, total: 12 });
  await assert.rejects(manage.listFlights({ page: '0' }), { status: 400 });
  await assert.rejects(manage.listFlights({ from: 'mañana' }), { status: 400 });
});

test('cada modelo de la flota tiene familia, y la aeronave la guarda al registrarla', () => {
  for (const model of AIRCRAFT_MODELS) {
    assert.match(model.family, /^[A-Z0-9]{3,4}$/, model.id);
  }
  const aircraft = validateAircraftInput(
    {
      registration: 'N391DN',
      msn: '10342',
      model_id: 'a321neo',
      base: 'ATL',
      manufacture_year: 2021,
      in_fleet_since: '2022-01-15',
    },
    new Date('2026-11-22T12:00:00Z')
  );
  assert.equal(aircraft.family, 'A320');
});

test('POST /flights: solo el super_admin crea vuelos (supervisor y tripulante reciben 403)', async (t) => {
  noDatabase(t);
  for (const role of ['supervisor', 'crew']) {
    const server = app.listen(0);
    await once(server, 'listening');
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/flights`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenFor(role)}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ flight_number: 'DL1' }),
      });
      assert.equal(response.status, 403, role);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

test('flights_db.sql da coordenadas válidas a los 9 hubs y a los destinos que no son base', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { HUBS } = require('@vuelos/shared');
  const sql = fs.readFileSync(path.join(__dirname, '../../../database/flights_db.sql'), 'utf8');

  const block = sql.match(/UPDATE public\.airports AS a SET latitude = c\.latitude, longitude = c\.longitude\s+FROM \(VALUES([\s\S]*?)\) AS c\(code, latitude, longitude\)\s+WHERE a\.code = c\.code;/);
  assert.ok(block, 'falta el UPDATE de coordenadas de public.airports');
  const rows = [...block[1].matchAll(/\('([A-Z]{3})', (-?\d+\.\d+), (-?\d+\.\d+)\)/g)].map((match) => [
    match[1],
    Number(match[2]),
    Number(match[3]),
  ]);
  const codes = rows.map(([code]) => code);

  for (const code of [...HUBS.map((hub) => hub.code), 'CDG', 'LHR', 'CUN']) {
    assert.ok(codes.includes(code), `faltan las coordenadas de ${code}`);
  }
  for (const [code, latitude, longitude] of rows) {
    assert.ok(latitude >= -90 && latitude <= 90, `latitud de ${code}`);
    assert.ok(longitude >= -180 && longitude <= 180, `longitud de ${code}`);
  }
  assert.match(sql, /ALTER TABLE public\.airports ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;/);
  assert.match(sql, /ALTER TABLE public\.airports ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;/);
});
