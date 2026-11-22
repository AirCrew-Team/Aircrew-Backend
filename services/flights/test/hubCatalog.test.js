const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// BE-4 (D7): las bases de la flota y public.airports salen de los hubs de Delta
// (@vuelos/shared), y «nacional» es EE. UU.
const { HUBS } = require('@vuelos/shared');
const { AIRCRAFT_BASES } = require('../src/domain/aircraftCatalog');
const pool = require('../src/adapters/outbound/persistence/pool');
const flightRepository = require('../src/adapters/outbound/persistence/repositories/flightRepository');
const assignmentRepository = require('../src/adapters/outbound/persistence/repositories/assignmentRepository');

const sql = fs.readFileSync(path.join(__dirname, '../../../database/flights_db.sql'), 'utf8');

test('BE-4: AIRCRAFT_BASES son los 9 hubs (LGA incluido), con los nombres de siempre', () => {
  assert.deepEqual(AIRCRAFT_BASES.map((base) => base.code), HUBS.map((hub) => hub.code));
  const name = (code) => AIRCRAFT_BASES.find((base) => base.code === code).name;
  assert.equal(name('ATL'), 'Atlanta (ATL)');
  assert.equal(name('LAX'), 'Los Ángeles (LAX)');
  assert.equal(name('MSP'), 'Minneapolis (MSP)');
  assert.equal(name('JFK'), 'Nueva York (JFK)');
  assert.equal(name('LGA'), 'Nueva York LaGuardia (LGA)');
  assert.ok(Object.isFrozen(AIRCRAFT_BASES));
});

test('BE-4: flights_db.sql siembra public.airports con los mismos datos que los hubs', () => {
  const insert = sql.match(/INSERT INTO public\.airports \(code, icao, city, name, country, timezone\) VALUES([\s\S]*?)ON CONFLICT \(code\) DO UPDATE SET([\s\S]*?);/);
  assert.ok(insert, 'falta el INSERT … ON CONFLICT (code) DO UPDATE de public.airports');

  const rows = [...insert[1].matchAll(/\('([^']*)', '([^']*)', '([^']*)', '([^']*)', '([^']*)', '([^']*)'\)/g)]
    .map((match) => match.slice(1));
  assert.deepEqual(
    rows,
    HUBS.map((hub) => [hub.code, hub.icao, hub.city, hub.airport, hub.country, hub.timezone])
  );
  for (const column of ['icao', 'city', 'name', 'country', 'timezone']) {
    assert.match(insert[2], new RegExp(`${column} = EXCLUDED\\.${column}`));
  }
});

test('BE-4: solo se borran los aeropuertos colombianos de la demo antigua que ningún vuelo usa', () => {
  const remove = sql.match(/DELETE FROM public\.airports a\s+WHERE a\.code IN \(([^)]*)\)([\s\S]*?);/);
  assert.ok(remove, 'falta el DELETE de los aeropuertos de la demo antigua');
  assert.equal(remove[1], "'BOG', 'MDE', 'CLO', 'CTG'");
  assert.match(remove[2], /NOT EXISTS \(\s*SELECT 1 FROM public\.flights f\s+WHERE f\.origin = a\.code OR f\.destination = a\.code\s*\)/);
});

// Revisión final: doméstico solo con los dos aeropuertos conocidos y de EE. UU.; uno
// desconocido cuenta como internacional (antes contaba como de EE. UU.). Ver flightScope.test.js.
test('BE-4: un vuelo es internacional si algún aeropuerto está fuera de EE. UU. o no está en el catálogo', async (t) => {
  const queries = [];
  t.mock.method(pool, 'query', async (text) => {
    queries.push(text);
    return { rows: [] };
  });

  await flightRepository.findFlights({ from: null, to: null });
  await assignmentRepository.findAssignmentsInRange({ from: '2026-07-01T00:00:00Z', to: '2026-07-02T00:00:00Z' });

  assert.equal(queries.length, 2);
  for (const text of queries) {
    assert.match(text, /o\.country IS NOT DISTINCT FROM 'US' AND d\.country IS NOT DISTINCT FROM 'US'/);
    assert.doesNotMatch(text, /COALESCE\([od]\.country/);
    assert.doesNotMatch(text, /'CO'/);
  }
});
