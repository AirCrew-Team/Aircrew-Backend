const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const createGetAbsences = require('../src/application/use-cases/getAbsences');

const absences = [
  { id: 'a1', flight_id: 'f1', crew_user_id: 'u1' },
  { id: 'a2', flight_id: 'f1', crew_user_id: 'u2' },
  { id: 'a3', flight_id: 'f2', crew_user_id: 'u3' },
];
const flights = [
  { id: 'f1', gate: 'C04', origin_name: 'El Dorado', destination_name: 'Miami Intl', aircraft_family: 'A320' },
  { id: 'f2', gate: null, origin_name: 'El Dorado', destination_name: 'Barajas', aircraft_family: '787' },
];
const noNames = async (rows) => rows;

describe('Cola de ausencias con datos del vuelo', () => {
  it('agrega puerta, aeropuertos y familia del avión, pidiendo cada vuelo una sola vez', async () => {
    const requested = [];
    const getAbsences = createGetAbsences({ findAbsences: async () => absences }, noNames, {
      getFlightsByIds: async (ids, auth) => {
        requested.push({ ids, auth });
        return flights;
      },
    });

    const result = await getAbsences({ status: 'reported' }, 'Bearer sup');

    assert.deepEqual(requested, [{ ids: ['f1', 'f2'], auth: 'Bearer sup' }]);
    assert.deepEqual(
      result.map((a) => [a.id, a.gate, a.destination_name, a.aircraft_family]),
      [['a1', 'C04', 'Miami Intl', 'A320'], ['a2', 'C04', 'Miami Intl', 'A320'], ['a3', null, 'Barajas', '787']]
    );
  });

  it('si Flights falla, la cola sale igual con esos campos en null', async (t) => {
    t.mock.method(console, 'error', () => {});
    const getAbsences = createGetAbsences({ findAbsences: async () => absences }, noNames, {
      getFlightsByIds: async () => {
        throw new Error('No se pudo consultar el servicio de vuelos.');
      },
    });

    const result = await getAbsences({}, 'Bearer sup');

    assert.equal(result.length, 3);
    assert.deepEqual(
      { gate: result[0].gate, origin_name: result[0].origin_name, destination_name: result[0].destination_name, aircraft_family: result[0].aircraft_family },
      { gate: null, origin_name: null, destination_name: null, aircraft_family: null }
    );
  });

  it('si no hay ausencias, no llama a Flights', async () => {
    let called = false;
    const getAbsences = createGetAbsences({ findAbsences: async () => [] }, noNames, {
      getFlightsByIds: async () => {
        called = true;
        return [];
      },
    });
    assert.deepEqual(await getAbsences({}, 'Bearer sup'), []);
    assert.equal(called, false);
  });

  it('rechaza un status inválido', async () => {
    const getAbsences = createGetAbsences({ findAbsences: async () => [] }, noNames, { getFlightsByIds: async () => [] });
    await assert.rejects(getAbsences({ status: 'otro' }, 'Bearer sup'), { status: 400 });
  });
});
