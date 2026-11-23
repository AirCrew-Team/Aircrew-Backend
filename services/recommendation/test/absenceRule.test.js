const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { firstFailure } = require('../src/domain/rules/eligibilityRules');
const { evaluateForSlot } = require('../src/domain/services/crewPlanning');

// Un tripulante con una ausencia reportada (no cancelada) no se ofrece para un vuelo que
// cae en sus fechas ni para el vuelo de su ausencia. Después de la ausencia, sí.
// Crew manda las ausencias vigentes de cada tripulante en `absences`.

// Sale el 21 a las 15:00Z (11:00 en Nueva York) y llega a las 18:00Z.
const flight = {
  id: 'f-21',
  flight_number: 'DL1102',
  origin: 'JFK',
  destination: 'LAX',
  departure_at: '2099-11-21T15:00:00Z',
  arrival_at: '2099-11-21T18:00:00Z',
  aircraft_family: 'A320',
  scope: 'domestic',
};

const member = {
  user_id: 'u1',
  employee_code: 'AC-1',
  rank: 'first_officer',
  ratings: ['A320'],
  english_level: 5,
  is_active: true,
  status: 'available',
  base_code: 'JFK',
  absences: [],
};

const check = (absences, f = {}) =>
  firstFailure({ member: { ...member, absences }, flight: { ...flight, ...f }, role: 'first_officer', memberAssignments: [] });

describe('Regla de ausencias', () => {
  it('bloquea un vuelo dentro de las fechas de la ausencia', () => {
    assert.equal(
      check([{ flight_id: null, start_date: '2099-11-20', end_date: '2099-11-22' }]),
      'Está ausente del 2099-11-20 al 2099-11-22.'
    );
  });

  it('bloquea el primer y el último día de la ausencia', () => {
    assert.ok(check([{ flight_id: null, start_date: '2099-11-21', end_date: '2099-11-21' }]));
  });

  it('no bloquea un vuelo después de la ausencia', () => {
    assert.equal(check([{ flight_id: null, start_date: '2099-11-18', end_date: '2099-11-20' }]), null);
  });

  it('usa el día local de la base: 01:00Z del 22 sigue siendo el 21 en Nueva York', () => {
    const lateFlight = { departure_at: '2099-11-22T01:00:00Z', arrival_at: '2099-11-22T03:00:00Z' };
    assert.ok(check([{ flight_id: null, start_date: '2099-11-21', end_date: '2099-11-21' }], lateFlight));
  });

  it('bloquea el vuelo de una ausencia por vuelo', () => {
    assert.equal(
      check([{ flight_id: 'f-21', start_date: null, end_date: null }]),
      'Tiene una ausencia reportada para este vuelo.'
    );
    assert.equal(check([{ flight_id: 'otro', start_date: null, end_date: null }]), null);
  });

  it('sin ausencias (o sin el campo) no bloquea', () => {
    assert.equal(check([]), null);
    assert.equal(
      firstFailure({ member: { ...member, absences: undefined }, flight, role: 'first_officer', memberAssignments: [] }),
      null
    );
  });

  it('en Programación el ausente sale en «No cumplen» con el motivo, no como elegible', () => {
    const slot = { id: 'first_officer', role: 'first_officer', accepts: ['first_officer'] };
    const absent = { ...member, absences: [{ flight_id: null, start_date: '2099-11-20', end_date: '2099-11-22' }] };
    const { eligible, ineligible } = evaluateForSlot({ members: [absent], flight, slot, assignments: [] });

    assert.deepEqual(eligible, []);
    assert.equal(ineligible[0].reason, 'Está ausente del 2099-11-20 al 2099-11-22.');
  });
});
