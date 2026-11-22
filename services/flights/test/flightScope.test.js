const { test } = require('node:test');
const assert = require('node:assert/strict');

// Revisión final: «nacional» ya no falla en abierto. Un vuelo es doméstico solo si los
// dos aeropuertos están en public.airports con country 'US'; uno desconocido (sin fila)
// cuenta como internacional, así la regla del inglés OACI 4 se aplica de más y no de
// menos. Aquí se revisa el SQL con el pool simulado; con el Postgres desechable se
// comprobó JFK→CDG sin fila de CDG = international y JFK→LAX = domestic.

const pool = require('../src/adapters/outbound/persistence/pool');
const flightRepository = require('../src/adapters/outbound/persistence/repositories/flightRepository');
const assignmentRepository = require('../src/adapters/outbound/persistence/repositories/assignmentRepository');

const DOMESTIC_ONLY_IF_BOTH_US =
  /CASE WHEN o\.country IS NOT DISTINCT FROM 'US' AND d\.country IS NOT DISTINCT FROM 'US'\s+THEN 'domestic' ELSE 'international' END AS scope/;

function captureSql(t) {
  const queries = [];
  t.mock.method(pool, 'query', async (sql) => {
    queries.push(sql);
    return { rows: [] };
  });
  return queries;
}

test('Revisión: el detalle de vuelos es doméstico solo con los dos aeropuertos de US conocidos', async (t) => {
  const queries = captureSql(t);

  await flightRepository.findFlights({ from: null, to: null });

  assert.match(queries[0], DOMESTIC_ONLY_IF_BOTH_US);
  assert.doesNotMatch(queries[0], /COALESCE\([od]\.country/);
});

test('Revisión: las asignaciones con su vuelo usan la misma regla', async (t) => {
  const queries = captureSql(t);

  await assignmentRepository.findAssignmentsByCrewUser('6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b');

  assert.match(queries[0], DOMESTIC_ONLY_IF_BOTH_US);
  assert.doesNotMatch(queries[0], /COALESCE\([od]\.country/);
});
