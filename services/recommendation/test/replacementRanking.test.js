const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateReplacements, affinityLabel } = require('../src/domain/services/replacementRanking');

const NOW = Date.parse('2026-11-20T10:00:00Z');
const hoursFromNow = (h) => new Date(NOW + h * 3600000).toISOString();

function flightIn(hours) {
  return {
    id: 'f1',
    flight_number: 'AV-100',
    origin: 'BOG',
    destination: 'MDE',
    departure_at: hoursFromNow(hours),
    arrival_at: hoursFromNow(hours + 1),
    aircraft_family: 'A320',
    scope: 'domestic',
  };
}

function crew(code, overrides = {}) {
  return {
    user_id: code,
    employee_code: code,
    rank: 'first_officer',
    ratings: ['A320'],
    medical_expires_on: '2027-12-31',
    is_active: true,
    status: 'available',
    english_level: 5,
    base_code: 'BOG',
    ...overrides,
  };
}

function evaluate(members, hours = 5) {
  return evaluateReplacements({
    members,
    flight: flightIn(hours),
    role: 'first_officer',
    absentUserId: 'AUSENTE',
    assignments: [],
    now: NOW,
  });
}

describe('Prioridad de reemplazos', () => {
  it('ordena: de guardia en la base, libre en la base, otra base', () => {
    const { eligible } = evaluate([
      crew('OTRA', { base_code: 'MDE' }),
      crew('LIBRE'),
      crew('GUARDIA', { status: 'on_duty', minutes_to_ramp: 12 }),
    ]);
    assert.deepEqual(
      eligible.map((c) => [c.member.employee_code, c.metrics.tier]),
      [['GUARDIA', 'standby'], ['LIBRE', 'base'], ['OTRA', 'other_base']]
    );
  });

  it('nunca propone al tripulante ausente', () => {
    const { eligible, ineligible } = evaluate([crew('AUSENTE'), crew('LIBRE')]);
    const all = [...eligible, ...ineligible].map((c) => c.member.user_id);
    assert.ok(!all.includes('AUSENTE'));
  });

  it('otra base solo si faltan 4 h o más para la salida', () => {
    const lejos = evaluate([crew('OTRA', { base_code: 'MDE' })], 5);
    assert.equal(lejos.eligible.length, 1);

    const cerca = evaluate([crew('OTRA', { base_code: 'MDE' })], 3);
    assert.equal(cerca.eligible.length, 0);
    assert.match(cerca.ineligible[0].reason, /otra base \(MDE\)/);
  });

  it('una guardia vencida cuenta como libre en la base', () => {
    const { eligible } = evaluate([crew('G', { status: 'on_duty', standby_until: hoursFromNow(-1) })]);
    assert.equal(eligible[0].metrics.tier, 'base');
  });

  it('entre guardias, primero el que está más cerca de la rampa', () => {
    const { eligible } = evaluate([
      crew('LEJOS', { status: 'on_duty', minutes_to_ramp: 50 }),
      crew('CERCA', { status: 'on_duty', minutes_to_ramp: 5 }),
    ]);
    assert.deepEqual(eligible.map((c) => c.member.employee_code), ['CERCA', 'LEJOS']);
  });

  it('separa a los que no cumplen con su motivo', () => {
    const { eligible, ineligible } = evaluate([crew('SIN_A320', { ratings: ['787'] }), crew('OK')]);
    assert.deepEqual(eligible.map((c) => c.member.employee_code), ['OK']);
    assert.equal(ineligible[0].reason, 'No está habilitado en A320.');
  });

  it('el puntaje queda entre 0 y 100', () => {
    const { eligible } = evaluate([crew('G', { status: 'on_duty', minutes_to_ramp: 0 })]);
    assert.ok(eligible[0].score >= 0 && eligible[0].score <= 100);
  });
});

describe('Etiqueta de afinidad', () => {
  it('90 o más es óptimo, 75 o más alto, el resto aceptable', () => {
    assert.equal(affinityLabel(95), 'optimal');
    assert.equal(affinityLabel(90), 'optimal');
    assert.equal(affinityLabel(80), 'high');
    assert.equal(affinityLabel(60), 'acceptable');
  });
});
