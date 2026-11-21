const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isValidPassword } = require('../src/domain/value-objects/password');

describe('Política de contraseñas', () => {
  it('mínimo 8 caracteres', () => {
    assert.equal(isValidPassword('abc1234'), false);
    assert.equal(isValidPassword('abc12345'), true);
  });

  it('máximo 72 bytes (límite de bcrypt)', () => {
    assert.equal(isValidPassword('a'.repeat(72)), true);
    assert.equal(isValidPassword('a'.repeat(73)), false);
  });

  it('cuenta bytes, no letras, para el máximo (ñ = 2 bytes)', () => {
    assert.equal(isValidPassword('ñ'.repeat(36)), true); // 72 bytes
    assert.equal(isValidPassword('ñ'.repeat(37)), false); // 74 bytes
  });

  it('rechaza lo que no es texto', () => {
    assert.equal(isValidPassword(undefined), false);
    assert.equal(isValidPassword(12345678), false);
  });
});
