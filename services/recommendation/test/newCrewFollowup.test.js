const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateReplacementOutput } = require('../src/domain/services/aiReplacementPolicy');
const { validateScheduleOutput } = require('../src/domain/services/aiSchedulePolicy');
const { evaluateForSlot } = require('../src/domain/services/crewPlanning');
const { evaluateReplacements } = require('../src/domain/services/replacementRanking');

// Seguimiento de la revisión (spec tripulantes-nuevos-programacion): el orden «con
// advertencias, al final» y la advertencia se aplican en código, no solo en el prompt.

const WARNINGS = ['Sin habilitación registrada en A320', 'Sin nivel de inglés OACI registrado'];
const candidate = (id, warnings = []) => ({ member: { user_id: id }, warnings });

describe('Reemplazos: la respuesta de la IA no salta el orden ni la advertencia', () => {
  it('quien tiene advertencias va al final aunque la IA lo ponga primero, y lleva su advertencia', () => {
    const shortlist = [candidate('VET'), candidate('NEW', WARNINGS)];
    const output = {
      candidates: [
        { crew_id: 'NEW', affinity: 95, checks: ['Habilitado A320', '0 h este mes'], rationale: 'Muy descansado.' },
        { crew_id: 'VET', affinity: 90, checks: ['Habilitado A320'], rationale: 'Experiencia.' },
      ],
    };

    const ranked = validateReplacementOutput(output, shortlist);

    assert.deepEqual(ranked.map((item) => item.candidate.member.user_id), ['VET', 'NEW']);
    assert.deepEqual(ranked[1].checks, [...WARNINGS, '0 h este mes']);
    assert.deepEqual(ranked[0].checks, ['Habilitado A320']);
  });

  it('con solo la advertencia de inglés conserva la habilitación', () => {
    const shortlist = [candidate('ENG', ['Sin nivel de inglés OACI registrado'])];
    const output = { candidates: [{ crew_id: 'ENG', affinity: 80, checks: ['Habilitado A320'], rationale: 'Ok.' }] };

    assert.deepEqual(validateReplacementOutput(output, shortlist)[0].checks, [
      'Sin nivel de inglés OACI registrado',
      'Habilitado A320',
    ]);
  });
});

describe('Sugerir tripulación: un nuevo solo si no hay otra opción', () => {
  const slot = { id: 'first_officer' };

  it('rechaza al candidato con advertencias si hay uno sin advertencias libre', () => {
    const options = [{ slot, candidates: [candidate('VET'), candidate('NEW', WARNINGS)] }];
    const output = { assignments: [{ slot_id: 'first_officer', crew_id: 'NEW', rationale: 'Nuevo.' }] };

    assert.equal(validateScheduleOutput(output, options).has('first_officer'), false);
  });

  it('lo acepta si es la única opción del puesto', () => {
    const options = [{ slot, candidates: [candidate('NEW', WARNINGS)] }];
    const output = { assignments: [{ slot_id: 'first_officer', crew_id: 'NEW', rationale: 'Nuevo.' }] };

    assert.equal(validateScheduleOutput(output, options).get('first_officer').candidate.member.user_id, 'NEW');
  });

  it('lo acepta si el que no tiene advertencias ya va en otro puesto', () => {
    const options = [
      { slot: { id: 'captain' }, candidates: [candidate('VET')] },
      { slot, candidates: [candidate('VET'), candidate('NEW', WARNINGS)] },
    ];
    const output = {
      assignments: [
        { slot_id: 'captain', crew_id: 'VET', rationale: 'Capitán.' },
        { slot_id: 'first_officer', crew_id: 'NEW', rationale: 'Nuevo.' },
      ],
    };

    assert.equal(validateScheduleOutput(output, options).get('first_officer').candidate.member.user_id, 'NEW');
  });
});

describe('Solo la advertencia de habilitación quita «Habilitado en»', () => {
  const flight = {
    id: 'f1',
    flight_number: 'DL1',
    origin: 'JFK',
    destination: 'CDG',
    departure_at: '2099-11-20T15:00:00Z',
    arrival_at: '2099-11-20T18:00:00Z',
    aircraft_family: 'A320',
    scope: 'international',
  };
  const pilot = {
    user_id: 'ENG',
    employee_code: 'AC-1',
    rank: 'first_officer',
    ratings: ['A320'],
    english_level: null,
    is_active: true,
    status: 'available',
    base_code: 'JFK',
  };

  it('en Programación', () => {
    const slot = { id: 'first_officer', role: 'first_officer', accepts: ['first_officer'] };
    const [item] = evaluateForSlot({ members: [pilot], flight, slot, assignments: [] }).eligible;
    assert.match(item.summary, /^Sin nivel de inglés OACI registrado · Habilitado en A320/);
  });

  it('en los reemplazos', () => {
    const [item] = evaluateReplacements({
      members: [pilot],
      flight,
      role: 'first_officer',
      absentUserId: 'X',
      assignments: [],
      now: new Date('2099-11-20T05:00:00Z').getTime(),
    }).eligible;
    assert.deepEqual(item.checks.slice(0, 2), ['Sin nivel de inglés OACI registrado', 'Habilitado A320']);
  });
});
