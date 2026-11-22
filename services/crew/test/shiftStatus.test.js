const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { currentShift, crewMemberShiftState, shiftOrder } = require('../src/domain/services/shiftStatus');

const at = (iso) => Date.parse(iso);
const NOW = at('2026-11-20T15:00:00Z'); // 10:00 en Colombia
const hoursFromNow = (h) => new Date(NOW + h * 3600000).toISOString();

describe('Turno según la hora de Colombia (UTC-5)', () => {
  it('mañana de 06:00 a 14:00', () => {
    assert.equal(currentShift(at('2026-11-20T11:00:00Z')), 'morning'); // 06:00
    assert.equal(currentShift(at('2026-11-20T18:59:00Z')), 'morning'); // 13:59
  });
  it('tarde de 14:00 a 22:00', () => {
    assert.equal(currentShift(at('2026-11-20T19:00:00Z')), 'afternoon'); // 14:00
  });
  it('noche de 22:00 a 06:00', () => {
    assert.equal(currentShift(at('2026-11-21T03:00:00Z')), 'night'); // 22:00
    assert.equal(currentShift(at('2026-11-20T10:59:00Z')), 'night'); // 05:59
  });
});

const member = (extra = {}) => ({
  user_id: 'u1', employee_code: 'E1', name: 'Ana', rank: 'first_officer', base_code: 'BOG',
  medical_expires_on: '2027-12-31', is_active: true, status: 'available', ...extra,
});
const flight = (id, depH, arrH) => ({ flight: { id, flight_number: id, origin: 'BOG', destination: 'MDE', departure_at: hoursFromNow(depH), arrival_at: hoursFromNow(arrH) } });
const state = (m, assignments = [], absence = null) => crewMemberShiftState(member(m), assignments, absence, NOW);

describe('Estado de cada tripulante en el turno', () => {
  it('ausente si tiene una ausencia abierta', () => {
    const result = state({}, [], { reason: 'illness', flight_id: 'f1', flight_number: 'AV-1' });
    assert.equal(result.status, 'absent');
    assert.equal(result.reason, 'illness');
    assert.equal(result.flight.flight_number, 'AV-1');
  });

  it('ausente por incapacidad, vacaciones o cuenta inactiva', () => {
    assert.equal(state({ status: 'medical_leave' }).reason, 'incapacidad médica');
    assert.equal(state({ status: 'vacation' }).reason, 'vacaciones');
    assert.equal(state({ is_active: false }).reason, 'inactivo');
  });

  it('en vuelo si tiene un vuelo en curso', () => {
    const result = state({}, [flight('AV-2', -1, 1)]);
    assert.equal(result.status, 'in_flight');
    assert.equal(result.flight.flight_number, 'AV-2');
  });

  it('de guardia, con bloqueo si el médico está vencido', () => {
    const ok = state({ status: 'on_duty', minutes_to_ramp: 12, standby_location: 'Sala' });
    assert.equal(ok.status, 'standby');
    assert.equal(ok.minutes_to_ramp, 12);
    assert.equal(ok.replacement_blocker, null);

    const vencido = state({ status: 'on_duty', medical_expires_on: '2026-11-01' });
    assert.equal(vencido.replacement_blocker, 'Certificado médico vencido.');
  });

  it('programado si sale en las próximas 12 h; presentación 90 min antes', () => {
    const result = state({}, [flight('AV-3', 4, 6)]);
    assert.equal(result.status, 'scheduled');
    assert.equal(result.report_at, new Date(NOW + 4 * 3600000 - 90 * 60000).toISOString());
  });

  it('un vuelo a más de 12 h no cuenta como programado', () => {
    assert.equal(state({}, [flight('AV-4', 13, 15)]).status, 'available');
  });

  it('descanso si aterrizó hace menos de 10 h', () => {
    const result = state({}, [flight('AV-5', -7, -5)]);
    assert.equal(result.status, 'rest');
    assert.equal(result.rest_until, hoursFromNow(5));
  });

  it('libre si no tiene nada', () => {
    assert.equal(state({}, [flight('AV-6', -15, -12)]).status, 'available');
  });

  it('avisa si el certificado médico vence en 30 días o menos', () => {
    assert.equal(state({ medical_expires_on: '2026-12-10' }).expiring_certification.name, 'Certificado médico');
    assert.equal(state({ medical_expires_on: '2027-06-01' }).expiring_certification, null);
  });
});

describe('Orden de la pantalla', () => {
  it('guardia (por rampa), en vuelo, programados, descanso, ausentes y libres', () => {
    const list = [
      { employee_code: 'L', status: 'available' },
      { employee_code: 'A', status: 'absent' },
      { employee_code: 'G2', status: 'standby', minutes_to_ramp: 40 },
      { employee_code: 'R', status: 'rest', rest_until: hoursFromNow(3) },
      { employee_code: 'P', status: 'scheduled', report_at: hoursFromNow(2) },
      { employee_code: 'V', status: 'in_flight', arrival_at: hoursFromNow(1) },
      { employee_code: 'G1', status: 'standby', minutes_to_ramp: 5 },
    ];
    assert.deepEqual(list.sort(shiftOrder).map((m) => m.employee_code), ['G1', 'G2', 'V', 'P', 'R', 'A', 'L']);
  });
});
