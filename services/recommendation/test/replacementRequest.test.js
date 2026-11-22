const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseRegenerateReason,
  assertCanBeReplaced,
  isValidAbsenceId,
} = require('../src/domain/entities/replacementRequest');

describe('Motivo al pedir nuevas sugerencias', () => {
  it('sin body, sin reason o vacío es null', () => {
    assert.equal(parseRegenerateReason(undefined), null);
    assert.equal(parseRegenerateReason({}), null);
    assert.equal(parseRegenerateReason({ reason: null }), null);
    assert.equal(parseRegenerateReason({ reason: '   ' }), null);
  });

  it('quita espacios al inicio y al final', () => {
    assert.equal(parseRegenerateReason({ reason: '  Ruta BOG-MIA ' }), 'Ruta BOG-MIA');
  });

  it('acepta 300 caracteres y rechaza 301', () => {
    assert.equal(parseRegenerateReason({ reason: 'x'.repeat(300) }).length, 300);
    assert.throws(() => parseRegenerateReason({ reason: 'x'.repeat(301) }), {
      status: 400,
      code: 'invalid_reason',
      field: 'reason',
    });
  });

  it('rechaza lo que no es texto', () => {
    assert.throws(() => parseRegenerateReason({ reason: 5 }), { status: 400, code: 'invalid_reason' });
    assert.throws(() => parseRegenerateReason({ reason: ['a'] }), { code: 'invalid_reason' });
  });
});

describe('¿La ausencia todavía admite reemplazo?', () => {
  const now = new Date('2026-11-20T10:00:00Z');
  const flight = { status: 'scheduled', departure_at: '2026-11-20T15:00:00Z' };

  it('sí, si está reported y el vuelo no ha salido', () => {
    assert.doesNotThrow(() => assertCanBeReplaced({ status: 'reported' }, flight, now));
    assert.doesNotThrow(() => assertCanBeReplaced({ status: 'reported' }, { ...flight, status: 'delayed' }, now));
  });

  it('no, si ya está cubierta, esperando «Enterado» o cancelada', () => {
    assert.throws(() => assertCanBeReplaced({ status: 'covered' }, flight, now), { status: 409, code: 'absence_covered' });
    assert.throws(() => assertCanBeReplaced({ status: 'pending_ack' }, flight, now), { code: 'absence_pending_ack' });
    assert.throws(() => assertCanBeReplaced({ status: 'cancelled' }, flight, now), { code: 'absence_cancelled' });
  });

  it('no, si el vuelo ya salió o fue cancelado', () => {
    const departed = { ...flight, departure_at: '2026-11-20T09:00:00Z' };
    assert.throws(() => assertCanBeReplaced({ status: 'reported' }, departed, now), { code: 'flight_closed' });
    assert.throws(() => assertCanBeReplaced({ status: 'reported' }, { ...flight, status: 'cancelled' }, now), {
      code: 'flight_closed',
    });
  });
});

describe('Id de la ausencia', () => {
  it('solo acepta UUID', () => {
    assert.ok(isValidAbsenceId('a09e80ee-b8c9-4386-9a7e-32c03032f07b'));
    assert.ok(!isValidAbsenceId('123'));
    assert.ok(!isValidAbsenceId(undefined));
  });
});
