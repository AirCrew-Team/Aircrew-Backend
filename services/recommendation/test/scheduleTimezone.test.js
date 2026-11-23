const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const createCrewScheduling = require('../src/application/use-cases/crewScheduling');

// BE-4 (D8): la programación agrupa los vuelos por el día local de la base
// pedida (?base=); sin base, Nueva York. Fechas de julio (horario de verano).
// 2026-07-16 06:30Z = 15 de julio a las 23:30 en Los Ángeles y 02:30 del 16 en Nueva York.
const LATE_LAX = {
  id: 'f1', flight_number: 'DL1520', origin: 'LAX', destination: 'JFK',
  departure_at: '2026-07-16T06:30:00Z', arrival_at: '2026-07-16T11:45:00Z', required_slots: [], assignments: [],
};

function setup({ now = new Date('2026-07-16T05:00:00Z') } = {}) {
  const calls = { listFlights: [] };
  const scheduling = createCrewScheduling({
    flightsClient: {
      listFlights: async (range) => {
        calls.listFlights.push(range);
        return [LATE_LAX];
      },
      getAssignments: async () => [],
      getCrewPlan: async () => LATE_LAX,
    },
    crewClient: { getCrewMembers: async () => [] },
    ai: { isEnabled: () => false },
    aiCallRepository: { saveAiCall: async () => {} },
    serviceAuthorization: () => 'Bearer servicio',
    now: () => now,
  });
  return { scheduling, calls };
}

describe('Programación por día local de la base', () => {
  it('con base LAX el día va de medianoche a medianoche de Los Ángeles', async () => {
    const { scheduling, calls } = setup();
    const [day] = await scheduling.getScheduleDays({ from: '2026-07-15', days: 1, base: 'LAX' }, 'Bearer sup');

    assert.deepEqual(calls.listFlights[0], { from: '2026-07-15T07:00:00.000Z', to: '2026-07-16T07:00:00.000Z' });
    assert.deepEqual(day, { date: '2026-07-15', flight_count: 1, pending_count: 1 });
  });

  it('sin base, el mismo vuelo es del 16 (Nueva York)', async () => {
    const { scheduling, calls } = setup();
    const days = await scheduling.getScheduleDays({ from: '2026-07-15', days: 2 }, 'Bearer admin');

    assert.deepEqual(calls.listFlights[0], { from: '2026-07-15T04:00:00.000Z', to: '2026-07-17T04:00:00.000Z' });
    assert.deepEqual(days.map((day) => day.flight_count), [0, 1]);
  });

  it('los vuelos de un día y su fecha salen en la zona de la base', async () => {
    const { scheduling, calls } = setup();
    const [flight] = await scheduling.getSchedule({ date: '2026-07-15', base: 'LAX' }, 'Bearer sup');

    assert.deepEqual(calls.listFlights[0], { from: '2026-07-15T07:00:00.000Z', to: '2026-07-16T07:00:00.000Z' });
    assert.equal(flight.date, '2026-07-15');
  });

  it('sin fecha, «hoy» es el de la base', async () => {
    const { scheduling, calls } = setup(); // 22:00 del 15 en Los Ángeles, 01:00 del 16 en Nueva York
    await scheduling.getSchedule({ base: 'LAX' }, 'Bearer sup');
    await scheduling.getSchedule({ base: 'JFK' }, 'Bearer sup');
    const [today] = await scheduling.getScheduleDays({ days: 1, base: 'SEA' }, 'Bearer sup');

    assert.equal(calls.listFlights[0].from, '2026-07-15T07:00:00.000Z');
    assert.equal(calls.listFlights[1].from, '2026-07-16T04:00:00.000Z');
    assert.equal(today.date, '2026-07-15');
  });

  it('un vuelo pedido por id lleva la fecha local de su aeropuerto de salida', async () => {
    const { scheduling } = setup();
    const flight = await scheduling.getPlannedFlight('f1', 'Bearer sup');
    assert.equal(flight.date, '2026-07-15');
  });

  it('el rango de la semana respeta el cambio de horario (día de 25 h)', async () => {
    const { scheduling, calls } = setup();
    await scheduling.getScheduleDays({ from: '2026-10-31', days: 2, base: 'LAX' }, 'Bearer sup');
    assert.deepEqual(calls.listFlights[0], { from: '2026-10-31T07:00:00.000Z', to: '2026-11-02T08:00:00.000Z' });
  });
});
