const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const createGetFlights = require('../src/application/use-cases/getFlights');

const ID_A = '6f1c2a2e-1111-4a4a-9b9b-123456789abc';
const ID_B = '6f1c2a2e-2222-4a4a-9b9b-123456789abc';

function setup(rows = []) {
  const queries = [];
  const getFlights = createGetFlights({
    findFlights: async (query) => {
      queries.push(query);
      return rows;
    },
  });
  return { getFlights, queries };
}

describe('Listar vuelos', () => {
  it('sin filtros consulta todo', async () => {
    const { getFlights, queries } = setup();
    await getFlights();
    assert.deepEqual(queries[0], { from: null, to: null, ids: null });
  });

  it('convierte from y to a ISO', async () => {
    const { getFlights, queries } = setup();
    await getFlights({ from: '2026-11-20', to: '2026-11-21' });
    assert.equal(queries[0].from, '2026-11-20T00:00:00.000Z');
    assert.equal(queries[0].to, '2026-11-21T00:00:00.000Z');
  });

  it('rechaza fechas inválidas', async () => {
    const { getFlights } = setup();
    await assert.rejects(getFlights({ from: 'ayer' }), { status: 400, message: /from debe ser una fecha/ });
  });

  it('ids: acepta UUID separados por comas y quita repetidos', async () => {
    const { getFlights, queries } = setup();
    await getFlights({ ids: `${ID_A}, ${ID_B},${ID_A}` });
    assert.deepEqual(queries[0].ids, [ID_A, ID_B]);
  });

  it('ids: rechaza valores que no son UUID o más de 200', async () => {
    const { getFlights } = setup();
    await assert.rejects(getFlights({ ids: 'abc' }), { status: 400, field: 'ids' });
    await assert.rejects(getFlights({ ids: ',' }), { status: 400, field: 'ids' });
    await assert.rejects(getFlights({ ids: Array(201).fill(ID_A).join(',') }), { status: 400 });
  });

  it('agrega los puestos requeridos a cada vuelo', async () => {
    const { getFlights } = setup([
      { id: ID_A, departure_at: '2026-11-20T10:00:00Z', arrival_at: '2026-11-20T12:00:00Z', aircraft_seats: 100 },
    ]);
    const [flight] = await getFlights();
    assert.deepEqual(flight.required_slots.map((s) => s.id), ['captain', 'first_officer', 'purser', 'fa-1']);
  });
});
