const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { firstFailure, warningsFor } = require('../src/domain/rules/eligibilityRules');
const { evaluateForSlot, buildPlannedFlight } = require('../src/domain/services/crewPlanning');
const { evaluateReplacements } = require('../src/domain/services/replacementRanking');

// Spec tripulantes-nuevos-programacion: un tripulante recién creado (sin habilitaciones,
// inglés ni horas) es una opción, con advertencia y detrás de los que tienen los datos.

const flight = {
  id: 'f1',
  flight_number: 'DL1102',
  origin: 'JFK',
  destination: 'CDG',
  departure_at: '2099-11-20T15:00:00Z',
  arrival_at: '2099-11-20T18:00:00Z',
  aircraft_family: 'A320',
  scope: 'international',
};

const veteran = {
  user_id: 'VET',
  employee_code: 'AC-0001',
  rank: 'first_officer',
  ratings: ['A320'],
  english_level: 5,
  medical_expires_on: '2099-12-31',
  is_active: true,
  status: 'available',
  base_code: 'JFK',
};

// Recién creado: lo que deja hoy el alta del admin.
const rookie = {
  user_id: 'NEW',
  employee_code: 'AC-0099',
  rank: 'first_officer',
  ratings: [],
  english_level: null,
  medical_expires_on: null,
  is_active: true,
  status: 'available',
  base_code: 'JFK',
};

// El veterano lleva 60 h en el mes: el nuevo (0 h) tendría mejor puntaje.
const veteranHours = [
  {
    crew_user_id: 'VET',
    flight: {
      id: 'old',
      flight_number: 'OLD',
      departure_at: '2099-11-02T00:00:00Z',
      arrival_at: '2099-11-04T12:00:00Z',
    },
  },
];

const NEW_WARNINGS = ['Sin habilitación registrada en A320', 'Sin nivel de inglés OACI registrado'];
const context = (member) => ({ member, flight, role: 'first_officer', memberAssignments: [] });
const slot = { id: 'first_officer', role: 'first_officer', label: 'Primer oficial', accepts: ['first_officer'] };

describe('Tripulante nuevo: el dato que falta no bloquea (NC-03, NC-06)', () => {
  it('sin habilitaciones ni inglés es elegible', () => {
    assert.equal(firstFailure(context(rookie)), null);
  });

  it('lleva las advertencias del dato que falta', () => {
    assert.deepEqual(warningsFor(context(rookie)), NEW_WARNINGS);
    assert.deepEqual(warningsFor(context(veteran)), []);
  });

  it('el inglés solo se advierte a pilotos en vuelos internacionales', () => {
    assert.deepEqual(warningsFor({ ...context(rookie), flight: { ...flight, scope: 'domestic' } }), [
      'Sin habilitación registrada en A320',
    ]);
  });

  it('el dato que existe y no cumple sigue bloqueando', () => {
    assert.equal(firstFailure(context({ ...rookie, ratings: ['787'] })), 'No está habilitado en A320.');
    assert.match(firstFailure(context({ ...rookie, english_level: 3 })), /Inglés OACI 3/);
  });
});

describe('Asignado con datos sin registrar', () => {
  it('el puesto ocupado lleva sus advertencias para que la pantalla no afirme la habilitación', () => {
    const plan = {
      ...flight,
      required_slots: [slot],
      assignments: [{ slot_id: 'first_officer', crew_user_id: 'NEW', source: 'manual', rationale: null }],
    };
    const planned = buildPlannedFlight(plan, [rookie, veteran], [], 'America/New_York');
    assert.deepEqual(planned.slots[0].assignee.warnings, NEW_WARNINGS);
  });
});

describe('Orden: con advertencias, al final (NC-04, NC-05, NC-08)', () => {
  it('en Programación el nuevo es elegible, va detrás del veterano y su resumen avisa', () => {
    const { eligible, ineligible } = evaluateForSlot({
      members: [rookie, veteran],
      flight,
      slot,
      assignments: veteranHours,
    });

    assert.deepEqual(ineligible, []);
    assert.deepEqual(eligible.map((item) => item.member.user_id), ['VET', 'NEW']);
    assert.deepEqual(eligible[1].warnings, NEW_WARNINGS);
    assert.match(eligible[1].summary, /Sin habilitación registrada en A320/);
    assert.doesNotMatch(eligible[1].summary, /Habilitado en A320/);
    assert.deepEqual(eligible[0].warnings, []);
  });

  it('si es la única opción, es elegible igual', () => {
    const { eligible } = evaluateForSlot({ members: [rookie], flight, slot, assignments: [] });
    assert.deepEqual(eligible.map((item) => item.member.user_id), ['NEW']);
  });

  it('en los reemplazos de una ausencia también va al final, con la advertencia en sus datos', () => {
    const { eligible } = evaluateReplacements({
      members: [rookie, veteran],
      flight,
      role: 'first_officer',
      absentUserId: 'ABSENT',
      assignments: veteranHours,
      now: new Date('2099-11-20T05:00:00Z').getTime(),
    });

    assert.deepEqual(eligible.map((item) => item.member.user_id), ['VET', 'NEW']);
    assert.deepEqual(eligible[1].warnings, NEW_WARNINGS);
    assert.ok(eligible[1].checks.includes('Sin habilitación registrada en A320'));
    assert.ok(!eligible[1].checks.includes('Habilitado A320'));
  });
});
