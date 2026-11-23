const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildPlannedFlight } = require('../src/domain/services/crewPlanning');

// Un tripulante asignado que después reporta una ausencia que cubre el vuelo sigue en
// el puesto hasta que se confirma su reemplazo (así lo sustituye ese flujo), pero
// Programación lo marca como ausente y el vuelo deja de contar como completo.

const slot = { id: 'first_officer', role: 'first_officer', label: 'Primer oficial', accepts: ['first_officer'] };
const plan = {
  id: 'f-21',
  flight_number: 'DL1102',
  origin: 'JFK',
  destination: 'LAX',
  departure_at: '2099-11-21T15:00:00Z',
  arrival_at: '2099-11-21T18:00:00Z',
  aircraft_family: 'A320',
  scope: 'domestic',
  crew_status: 'complete',
  required_slots: [slot],
  assignments: [{ slot_id: 'first_officer', crew_user_id: 'u1', source: 'manual', rationale: null }],
};
const member = {
  user_id: 'u1',
  employee_code: 'AC-1',
  rank: 'first_officer',
  ratings: ['A320'],
  base_code: 'JFK',
  absences: [],
};

describe('Asignado que se ausenta', () => {
  it('queda marcado como ausente y el vuelo pasa a incompleto', () => {
    const absent = { ...member, absences: [{ flight_id: null, start_date: '2099-11-20', end_date: '2099-11-22' }] };
    const planned = buildPlannedFlight(plan, [absent], [], 'America/New_York');

    assert.equal(planned.slots[0].assignee.absence, 'Está ausente del 2099-11-20 al 2099-11-22.');
    assert.equal(planned.status, 'incomplete');
  });

  it('sin ausencia sigue igual', () => {
    const planned = buildPlannedFlight(plan, [member], [], 'America/New_York');

    assert.equal(planned.slots[0].assignee.absence, null);
    assert.equal(planned.status, 'complete');
  });
});
