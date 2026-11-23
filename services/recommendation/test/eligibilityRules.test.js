const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { firstFailure } = require('../src/domain/rules/eligibilityRules');

// Vuelo internacional A320 de 3 h y un primer oficial que cumple todo.
const flight = {
  id: 'f1',
  flight_number: 'AV-100',
  origin: 'BOG',
  destination: 'MIA',
  departure_at: '2026-11-20T15:00:00Z',
  arrival_at: '2026-11-20T18:00:00Z',
  aircraft_family: 'A320',
  scope: 'international',
};

const member = {
  user_id: 'u1',
  rank: 'first_officer',
  ratings: ['A320'],
  medical_expires_on: '2027-06-30',
  is_active: true,
  status: 'available',
  english_level: 5,
  base_code: 'BOG',
};

function other(id, departure, arrival) {
  return { crew_user_id: 'u1', flight: { id, flight_number: id, departure_at: departure, arrival_at: arrival } };
}

function check({ m = {}, f = {}, role = 'first_officer', assignments = [] } = {}) {
  return firstFailure({
    member: { ...member, ...m },
    flight: { ...flight, ...f },
    role,
    memberAssignments: assignments,
  });
}

describe('Las 8 reglas de elegibilidad', () => {
  it('quien cumple todo es elegible', () => {
    assert.equal(check(), null);
  });

  describe('1. rango', () => {
    it('rechaza un cargo que no es el del puesto', () => {
      assert.match(check({ m: { rank: 'purser' } }), /no sirve para first_officer/);
    });
    it('el piloto de relevo puede ser capitán o primer oficial', () => {
      assert.equal(check({ role: 'relief', m: { rank: 'captain' } }), null);
      assert.equal(check({ role: 'relief', m: { rank: 'first_officer' } }), null);
      assert.ok(check({ role: 'relief', m: { rank: 'purser' } }));
    });
  });

  describe('2. habilitación', () => {
    it('rechaza a quien no está habilitado en la familia del avión', () => {
      assert.equal(check({ m: { ratings: ['787'] } }), 'No está habilitado en A320.');
    });
    it('no exige habilitación si el vuelo no tiene familia', () => {
      assert.equal(check({ m: { ratings: [] }, f: { aircraft_family: null } }), null);
    });
  });

  // El certificado médico se descartó (spec tripulantes-nuevos-programacion): no es regla.
  describe('sin regla de certificado médico (NC-07)', () => {
    it('no rechaza a quien no tiene certificado o lo tiene vencido', () => {
      assert.equal(check({ m: { medical_expires_on: null } }), null);
      assert.equal(check({ m: { medical_expires_on: '2026-11-19' } }), null);
    });
  });

  describe('4. disponibilidad', () => {
    it('rechaza a un usuario inactivo', () => {
      assert.equal(check({ m: { is_active: false } }), 'Está inactivo.');
    });
    it('rechaza incapacidad, vacaciones o estar en vuelo', () => {
      assert.match(check({ m: { status: 'medical_leave' } }), /incapacidad médica/);
      assert.match(check({ m: { status: 'vacation' } }), /vacaciones/);
      assert.match(check({ m: { status: 'in_flight' } }), /en vuelo/);
    });
    it('acepta a quien está de guardia (on_duty)', () => {
      assert.equal(check({ m: { status: 'on_duty' } }), null);
    });
  });

  describe('5. solape', () => {
    it('rechaza a quien ya está en este vuelo', () => {
      assert.equal(
        check({ assignments: [other('f1', flight.departure_at, flight.arrival_at)] }),
        'Ya está asignado a este vuelo.'
      );
    });
    it('rechaza a quien tiene otro vuelo que se cruza', () => {
      const result = check({ assignments: [other('AV-200', '2026-11-20T16:00:00Z', '2026-11-20T19:00:00Z')] });
      assert.match(result, /AV-200, que se cruza/);
    });
  });

  describe('6. descanso de 10 h', () => {
    it('rechaza si aterrizó 9 h antes de la salida', () => {
      const result = check({ assignments: [other('AV-300', '2026-11-20T03:00:00Z', '2026-11-20T06:00:00Z')] });
      assert.match(result, /10 h de descanso por el vuelo AV-300/);
    });
    it('acepta si aterrizó justo 10 h antes', () => {
      assert.equal(check({ assignments: [other('AV-300', '2026-11-20T02:00:00Z', '2026-11-20T05:00:00Z')] }), null);
    });
    it('rechaza si sale de nuevo menos de 10 h después de aterrizar', () => {
      const result = check({ assignments: [other('AV-400', '2026-11-21T03:00:00Z', '2026-11-21T05:00:00Z')] });
      assert.match(result, /AV-400/);
    });
  });

  // Revisión final: 100 h (14 CFR 117.23), las mismas que muestra Mis Vuelos, en el mes
  // local de la base del tripulante (Nueva York para una base desconocida como BOG).
  describe('7. máximo 100 h al mes', () => {
    it('acepta llegar exactamente a 100 h con este vuelo (97 + 3)', () => {
      assert.equal(check({ assignments: [other('LARGO', '2026-11-02T00:00:00Z', '2026-11-06T01:00:00Z')] }), null);
    });
    it('rechaza pasar de 100 h (98 + 3)', () => {
      const result = check({ assignments: [other('LARGO', '2026-11-02T00:00:00Z', '2026-11-06T02:00:00Z')] });
      assert.match(result, /Superaría 100 h de vuelo en el mes \(101 h\)/);
    });
    it('no cuenta las horas de otro mes', () => {
      assert.equal(check({ assignments: [other('OCT', '2026-10-01T05:00:00Z', '2026-10-05T05:00:00Z')] }), null);
    });

    // Verano: el 1 de julio a las 05:00Z es 30 de junio en Los Ángeles y 1 de julio en
    // Nueva York. 98 h voladas en junio (local) más este vuelo de 3 h.
    const JUNE_98 = other('JUNIO', '2026-06-02T12:00:00Z', '2026-06-06T14:00:00Z');
    const EARLY_UTC_JULY = { departure_at: '2026-07-01T05:00:00Z', arrival_at: '2026-07-01T08:00:00Z' };

    it('el mes es el local de la base: un vuelo el 1 de julio (UTC) cuenta en junio para LAX', () => {
      const result = check({ m: { base_code: 'LAX' }, f: EARLY_UTC_JULY, assignments: [JUNE_98] });
      assert.match(result, /Superaría 100 h de vuelo en el mes \(101 h\)/);
    });

    it('el mismo vuelo cuenta en julio para JFK: las horas de junio no suman', () => {
      assert.equal(check({ m: { base_code: 'JFK' }, f: EARLY_UTC_JULY, assignments: [JUNE_98] }), null);
    });

    it('un vuelo de la noche del 30 de junio en LAX (1 de julio UTC) no suma al julio local', () => {
      const lateJune = other('NOCHE', '2026-07-01T01:00:00Z', '2026-07-05T03:00:00Z');
      const july = { departure_at: '2026-07-15T15:00:00Z', arrival_at: '2026-07-15T18:00:00Z' };
      assert.equal(check({ m: { base_code: 'LAX' }, f: july, assignments: [lateJune] }), null);
    });
  });

  describe('8. inglés OACI en internacionales', () => {
    it('rechaza a un piloto con nivel 3 en vuelo internacional', () => {
      assert.match(check({ m: { english_level: 3 } }), /se requiere 4/);
    });
    // Spec tripulantes-nuevos-programacion: sin registro no bloquea; es una advertencia.
    it('no rechaza a un piloto sin nivel registrado', () => {
      assert.equal(check({ m: { english_level: null } }), null);
    });
    it('no lo exige en vuelos nacionales', () => {
      assert.equal(check({ m: { english_level: 2 }, f: { scope: 'domestic' } }), null);
    });
    it('no lo exige a la tripulación de cabina', () => {
      assert.equal(check({ role: 'flight_attendant', m: { rank: 'flight_attendant', english_level: 1 } }), null);
    });
  });

  it('devuelve el primer motivo en el orden de las reglas', () => {
    const result = check({ m: { rank: 'purser', ratings: [], is_active: false } });
    assert.match(result, /no sirve para/);
  });
});
