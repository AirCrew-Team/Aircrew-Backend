const { test } = require('node:test');
const assert = require('node:assert/strict');

const createCreateFlight = require('../src/application/use-cases/createFlight');
const { createManageFlights, normalizeSearch } = require('../src/application/use-cases/manageFlights');
const { createFlight: buildFlight } = require('../src/domain/entities/flight');

const AIRCRAFT_ID = '11111111-1111-4111-8111-111111111111';
const valid = {
  flight_number: 'dl1234',
  aircraft_id: AIRCRAFT_ID,
  origin: 'atl',
  destination: 'JFK',
  departure_at: '2026-11-24T13:00:00.000Z',
  arrival_at: '2026-11-24T15:05:00.000Z',
  gate: 'a12',
};

function setup(overrides = {}) {
  const created = [];
  const flightRepository = {
    findAirportsByCodes: async (codes) => codes.filter((code) => code !== 'XYZ').map((code) => ({ code })),
    findFlightByNumberOnDay: async () => null,
    findOverlappingFlight: async () => null,
    createFlight: async (flight) => {
      created.push(flight);
      return { id: 'new-id' };
    },
    findFlightById: async () => ({
      id: 'new-id',
      flight_number: 'DL1234',
      departure_at: valid.departure_at,
      arrival_at: valid.arrival_at,
      aircraft_seats: 186,
      origin_timezone: 'America/New_York',
      destination_timezone: 'America/New_York',
      crew_confirmed_at: null,
    }),
    ...overrides.flightRepository,
  };
  const aircraftRepository = {
    findAircraftById: async () => ({ id: AIRCRAFT_ID, status: 'operating' }),
    ...overrides.aircraftRepository,
  };
  // «Ahora» fijo, antes de la salida de `valid`.
  const now = overrides.now || (() => new Date('2026-11-22T12:00:00.000Z'));
  return { createFlight: createCreateFlight({ flightRepository, aircraftRepository, now }), created };
}

const rejects = (promise, status, message) =>
  assert.rejects(promise, (error) => {
    assert.equal(error.status, status);
    assert.equal(error.message, message);
    return true;
  });

test('crea el vuelo normalizado y responde con el detalle, required_slots y crew_status', async () => {
  const { createFlight, created } = setup();
  const flight = await createFlight(valid);

  assert.equal(created[0].flightNumber, 'DL1234');
  assert.equal(created[0].origin, 'ATL');
  assert.equal(created[0].gate, 'A12');
  assert.equal(flight.crew_status, 'unassigned');
  assert.equal(flight.required_slots, 6); // 2 pilotos + 4 de cabina (186 sillas)
  assert.equal(flight.origin_timezone, 'America/New_York');
});

test('número de vuelo mal escrito: 400', async () => {
  const { createFlight } = setup();
  const message = 'Usa el código de la aerolínea y de 1 a 4 números (ej. DL1234).';
  for (const number of ['dl12345', 'D1', 'DL-12', 'DL']) {
    await rejects(createFlight({ ...valid, flight_number: number }), 400, message);
  }
  assert.equal(buildFlight({ ...toEntity(valid), flightNumber: ' av9 ' }).flightNumber, 'AV9');
});

test('aeropuerto fuera del catálogo: 400', async () => {
  const { createFlight } = setup();
  await rejects(createFlight({ ...valid, origin: 'xyz' }), 400, 'El aeropuerto XYZ no está en el catálogo.');
});

test('más de 20 h o llegada antes de la salida: 400', async () => {
  const { createFlight } = setup();
  const message = 'La llegada debe ser después de la salida y el vuelo durar máximo 20 h.';
  await rejects(createFlight({ ...valid, arrival_at: '2026-11-25T11:00:00.000Z' }), 400, message);
  await rejects(createFlight({ ...valid, arrival_at: '2026-11-24T12:00:00.000Z' }), 400, message);
});

test('gate de más de 5 caracteres: 400; vacío queda en null', async () => {
  const { createFlight, created } = setup();
  await assert.rejects(createFlight({ ...valid, gate: 'ABCDEF' }), { status: 400 });
  await createFlight({ ...valid, gate: '' });
  assert.equal(created[0].gate, null);
});

test('mismo número el mismo día: 409', async () => {
  const { createFlight } = setup({ flightRepository: { findFlightByNumberOnDay: async () => ({ id: 'x' }) } });
  await rejects(createFlight(valid), 409, 'Ya existe el vuelo DL1234 el 2026-11-24.');
});

test('la aeronave ya vuela a esa hora: 409 con la hora local del origen del otro vuelo', async () => {
  const { createFlight } = setup({
    flightRepository: {
      findOverlappingFlight: async () => ({
        flight_number: 'DL0500',
        aircraft_registration: 'N991AC',
        departure_at: '2026-11-24T13:00:00.000Z',
        arrival_at: '2026-11-24T14:10:00.000Z',
        origin_timezone: 'America/New_York',
      }),
    },
  });
  await rejects(createFlight(valid), 409, 'N991AC ya vuela de 08:00 a 09:10 (DL0500).');
});

test('/manage: valida page_size y status; /stats cuenta los vuelos sin tripulación', async () => {
  const flight = (id, assigned) => ({
    id,
    departure_at: valid.departure_at,
    arrival_at: valid.arrival_at,
    aircraft_seats: 50,
    crew_confirmed_at: null,
    assigned,
  });
  const flights = [flight('a', []), flight('b', ['captain']), flight('c', ['captain', 'first_officer', 'purser'])];
  const manage = createManageFlights({
    flightRepository: {
      findFlightsPage: async () => ({ rows: flights, total: 3 }),
      countFlights: async () => [
        { status: 'scheduled', total: 3, today: 1 },
        { status: 'cancelled', total: 1, today: 0 },
      ],
      findOpenFlights: async () => flights,
    },
    aircraftRepository: {},
    assignmentRepository: {
      findActiveByFlights: async () =>
        flights.flatMap((item) => item.assigned.map((slot) => ({ flight_id: item.id, slot_id: slot, status: 'assigned' }))),
    },
  });

  await assert.rejects(manage.listFlights({ page_size: '101' }), { status: 400 });
  await assert.rejects(manage.listFlights({ status: 'boarding' }), { status: 400 });

  const page = await manage.listFlights({});
  assert.deepEqual(page.items.map((item) => item.crew_status), ['unassigned', 'incomplete', 'complete']);
  assert.equal(page.page_size, 5);

  const stats = await manage.getStats();
  assert.deepEqual(stats, {
    total: 4,
    today: 1,
    without_crew: 2,
    by_status: { scheduled: 3, delayed: 0, in_flight: 0, completed: 0, cancelled: 1 },
  });
});

test('la búsqueda ignora mayúsculas y tildes y escapa los comodines', () => {
  assert.equal(normalizeSearch(' Cancún '), 'cancun');
  assert.equal(normalizeSearch('50%'), '50\\%');
  assert.equal(normalizeSearch('  '), null);
});

function toEntity(input) {
  return {
    flightNumber: input.flight_number,
    aircraftId: input.aircraft_id,
    origin: input.origin,
    destination: input.destination,
    departureAt: input.departure_at,
    arrivalAt: input.arrival_at,
  };
}

test('rechaza un vuelo con la salida en el pasado o ahora mismo (400 en departure_at)', async () => {
  for (const at of ['2026-11-24T13:00:00.000Z', '2026-11-25T00:00:00.000Z']) {
    const { createFlight, created } = setup({ now: () => new Date(at) });
    await assert.rejects(createFlight(valid), (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.field, 'departure_at');
      assert.equal(error.message, 'La salida debe ser en el futuro.');
      return true;
    });
    assert.equal(created.length, 0);
  }
});
