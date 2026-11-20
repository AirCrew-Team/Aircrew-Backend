// Spec cierre-tareas-johan, D4: el token del login nunca puede quedar antes del último
// cambio de contraseña, aunque el reloj del servicio vaya por detrás del de PostgreSQL.
// Si no, quien inicia sesión justo después de recuperar la contraseña recibiría 401.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'clave-de-pruebas';

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const createLogin = require('../src/application/use-cases/login');

const passwordHasher = { compare: async () => true };

function repoWith(passwordChangedAt) {
  return {
    findByEmail: async () => ({
      id: '0b5c1b0e-9f2a-4c1d-8e3f-1a2b3c4d5e6f',
      name: 'Cuenta de Prueba',
      email: 'cuenta@aircrew.test',
      role: 'crew',
      is_active: true,
      password_hash: 'hash-de-prueba',
      pending_activation: false,
      password_changed_at: passwordChangedAt,
    }),
  };
}

const iatOf = (token) => jwt.decode(token).iat;
const VALID_INPUT = { email: 'cuenta@aircrew.test', password: 'x'.repeat(12) };

test('D4: si password_changed_at va por delante del reloj, el iat del login es su segundo', async () => {
  const ahead = new Date(Date.now() + 5000);
  const login = createLogin({ userRepository: repoWith(ahead.toISOString()), passwordHasher });

  const { token } = await login(VALID_INPUT);

  assert.equal(iatOf(token), Math.floor(ahead.getTime() / 1000));
});

test('D4: con un cambio antiguo, el iat del login es la hora actual', async () => {
  const before = Math.floor(Date.now() / 1000);
  const login = createLogin({
    userRepository: repoWith('2020-01-01T00:00:00.000Z'),
    passwordHasher,
  });

  const iat = iatOf((await login(VALID_INPUT)).token);

  assert.ok(iat >= before && iat <= Math.floor(Date.now() / 1000));
});

test('D4: sin password_changed_at, el iat del login es la hora actual', async () => {
  const before = Math.floor(Date.now() / 1000);
  const login = createLogin({ userRepository: repoWith(null), passwordHasher });

  const iat = iatOf((await login(VALID_INPUT)).token);

  assert.ok(iat >= before && iat <= Math.floor(Date.now() / 1000));
});
