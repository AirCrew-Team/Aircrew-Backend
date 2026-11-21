const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { acknowledgementDeadline } = require('../src/domain/services/acknowledgementDeadline');

const NOW = Date.parse('2026-11-20T10:00:00Z');
const minutesFromNow = (m) => new Date(NOW + m * 60000).toISOString();
const deadlineMinutes = (departureInMinutes) =>
  (Date.parse(acknowledgementDeadline(minutesFromNow(departureInMinutes), NOW)) - NOW) / 60000;

describe('Plazo para el «Enterado»', () => {
  it('son 30 minutos si el vuelo sale en más de una hora', () => {
    assert.equal(deadlineMinutes(120), 30);
  });

  it('es la mitad del tiempo que falta si eso es menor', () => {
    assert.equal(deadlineMinutes(40), 20);
  });

  it('nunca es menor de 5 minutos', () => {
    assert.equal(deadlineMinutes(6), 5);
    assert.equal(deadlineMinutes(-10), 5);
  });
});
