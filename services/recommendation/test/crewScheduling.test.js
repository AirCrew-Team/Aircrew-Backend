const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const createCrewScheduling = require('../src/application/use-cases/crewScheduling');

// Vuelos de un mismo día: dos salen de BOG y uno llega a BOG desde MIA.
const flights = [
  { id: 'f1', flight_number: 'AV-9344', origin: 'BOG', destination: 'MIA', departure_at: '2026-11-20T15:00:00Z', arrival_at: '2026-11-20T19:00:00Z', required_slots: [] },
  { id: 'f2', flight_number: 'AV-9345', origin: 'MIA', destination: 'BOG', departure_at: '2026-11-20T21:00:00Z', arrival_at: '2026-11-21T01:00:00Z', required_slots: [] },
  { id: 'f3', flight_number: 'AV-4021', origin: 'BOG', destination: 'MAD', departure_at: '2026-11-20T23:00:00Z', arrival_at: '2026-11-21T09:00:00Z', required_slots: [], crew_confirmed_at: '2026-11-19T10:00:00Z' },
];

function setup() {
  return createCrewScheduling({
    flightsClient: { listFlights: async () => flights, getAssignments: async () => [] },
    crewClient: { getCrewMembers: async () => [] },
    ai: { isEnabled: () => false },
    aiCallRepository: { saveAiCall: async () => {} },
    serviceAuthorization: () => 'Bearer servicio',
  });
}

describe('Programación filtrada por base', () => {
  it('con base, solo los vuelos que salen de ahí (no los que llegan)', async () => {
    const day = await setup().getSchedule({ date: '2026-11-20', base: 'BOG' }, 'Bearer sup');
    assert.deepEqual(day.map((f) => f.flight_number), ['AV-9344', 'AV-4021']);
  });

  it('la base no distingue mayúsculas', async () => {
    const day = await setup().getSchedule({ date: '2026-11-20', base: 'bog' }, 'Bearer sup');
    assert.equal(day.length, 2);
  });

  it('sin base, todos los vuelos', async () => {
    const day = await setup().getSchedule({ date: '2026-11-20' }, 'Bearer sup');
    assert.equal(day.length, 3);
  });

  it('el resumen de días también cuenta solo los de la base', async () => {
    const [today] = await setup().getScheduleDays({ from: '2026-11-20', days: 1, base: 'BOG' }, 'Bearer sup');
    assert.deepEqual(today, { date: '2026-11-20', flight_count: 2, pending_count: 1 });
  });

  it('rechaza una base que no es un código IATA', async () => {
    await assert.rejects(setup().getSchedule({ base: 'bogota' }, 'Bearer sup'), { status: 400, field: 'base' });
    await assert.rejects(setup().getScheduleDays({ base: 'B1' }, 'Bearer sup'), { status: 400, field: 'base' });
  });
});
