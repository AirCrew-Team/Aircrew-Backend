const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requiredSlots, crewStatus } = require('../src/domain/entities/crewComplement');

function flight(hours, seats, extra = {}) {
  const departure = Date.parse('2026-11-20T10:00:00Z');
  return {
    departure_at: new Date(departure).toISOString(),
    arrival_at: new Date(departure + hours * 3600000).toISOString(),
    aircraft_seats: seats,
    ...extra,
  };
}

const ids = (f) => requiredSlots(f).map((slot) => slot.id);

describe('Puestos requeridos por vuelo', () => {
  it('capitán, primer oficial, jefe de cabina y 1 TCP por cada 50 sillas (150 sillas)', () => {
    assert.deepEqual(ids(flight(3, 150)), ['captain', 'first_officer', 'purser', 'fa-1', 'fa-2']);
  });

  it('redondea hacia arriba las sillas (180 → 4 de cabina)', () => {
    assert.deepEqual(ids(flight(3, 180)), ['captain', 'first_officer', 'purser', 'fa-1', 'fa-2', 'fa-3']);
  });

  it('piloto de relevo solo si dura más de 8 h', () => {
    assert.ok(!ids(flight(8, 50)).includes('relief'));
    assert.ok(ids(flight(8.5, 50)).includes('relief'));
  });

  it('el relevo acepta capitán o primer oficial', () => {
    const relief = requiredSlots(flight(10, 50)).find((slot) => slot.id === 'relief');
    assert.deepEqual(relief.accepts, ['captain', 'first_officer']);
  });

  it('sin sillas registradas, al menos jefe de cabina', () => {
    assert.deepEqual(ids(flight(2, undefined)), ['captain', 'first_officer', 'purser']);
  });
});

describe('Estado de la tripulación', () => {
  const f = flight(2, 50); // captain, first_officer, purser
  const assigned = (slotId, status = 'assigned') => ({ slot_id: slotId, status });

  it('unassigned si nadie está asignado', () => {
    assert.equal(crewStatus(f, []), 'unassigned');
  });

  it('incomplete si faltan puestos', () => {
    assert.equal(crewStatus(f, [assigned('captain')]), 'incomplete');
  });

  it('complete si todos los puestos están ocupados', () => {
    assert.equal(crewStatus(f, [assigned('captain'), assigned('first_officer'), assigned('purser')]), 'complete');
  });

  it('no cuenta asignaciones que no están activas', () => {
    assert.equal(crewStatus(f, [assigned('captain', 'cancelled')]), 'unassigned');
  });

  it('confirmed si el supervisor ya confirmó, aunque falten puestos', () => {
    assert.equal(crewStatus({ ...f, crew_confirmed_at: '2026-11-19T10:00:00Z' }, []), 'confirmed');
  });
});
