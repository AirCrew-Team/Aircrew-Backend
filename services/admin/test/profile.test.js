const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  preferencesFor,
  validatePreferencesUpdate,
  validateProfileUpdate,
} = require('../src/domain/entities/profile');

describe('Preferencias de notificación', () => {
  it('cada rol tiene las suyas, activadas por defecto', () => {
    assert.deepEqual(preferencesFor({ role: 'supervisor' }), {
      absence_alerts: true,
      ai_suggestions_ready: true,
      deadline_missed: true,
    });
    assert.deepEqual(Object.keys(preferencesFor({ role: 'crew' })), [
      'urgent_replacement',
      'gate_changes',
      'certification_expiry',
    ]);
  });

  it('las guardadas pisan el valor por defecto y se ignoran las de otro rol', () => {
    const prefs = preferencesFor({
      role: 'supervisor',
      notification_preferences: { deadline_missed: false, gate_changes: false, absence_alerts: 'no' },
    });
    assert.deepEqual(prefs, { absence_alerts: true, ai_suggestions_ready: true, deadline_missed: false });
  });

  it('acepta cualquier subconjunto con true/false', () => {
    assert.deepEqual(validatePreferencesUpdate({ role: 'crew' }, { gate_changes: false }), { gate_changes: false });
  });

  it('rechaza vacío, preferencias de otro rol y valores que no son booleanos', () => {
    assert.throws(() => validatePreferencesUpdate({ role: 'crew' }, {}), { status: 400 });
    assert.throws(() => validatePreferencesUpdate({ role: 'supervisor' }, { gate_changes: false }), {
      status: 400,
      field: 'gate_changes',
    });
    assert.throws(() => validatePreferencesUpdate({ role: 'crew' }, { gate_changes: 'false' }), {
      field: 'gate_changes',
    });
  });
});

describe('Cambiar mi teléfono', () => {
  it('acepta formato E.164 y quita espacios', () => {
    assert.deepEqual(validateProfileUpdate({ phone: ' +573001234567 ' }), { phone: '+573001234567' });
  });

  it('null borra el teléfono', () => {
    assert.deepEqual(validateProfileUpdate({ phone: null }), { phone: null });
  });

  it('rechaza números sin indicativo, texto o sin phone', () => {
    assert.throws(() => validateProfileUpdate({ phone: '3001234567' }), { status: 400, field: 'phone' });
    assert.throws(() => validateProfileUpdate({ phone: '+57 300 123' }), { field: 'phone' });
    assert.throws(() => validateProfileUpdate({}), { field: 'phone' });
  });
});
