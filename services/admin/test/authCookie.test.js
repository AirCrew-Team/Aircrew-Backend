const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

// Se carga dentro de cada test: si el módulo no existe, cada criterio
// falla por separado con su propio motivo.
function loadAuthCookie() {
  return require('../src/adapters/inbound/http/authCookie');
}

const NOW = Date.UTC(2026, 10, 18, 12, 0, 0);

function signTokenExpiringIn(seconds) {
  return jwt.sign(
    { role: 'crew', exp: Math.floor(NOW / 1000) + seconds },
    'secreto-de-prueba'
  );
}

test('AUTH_COOKIE_NAME es aircrew_token', () => {
  const { AUTH_COOKIE_NAME } = loadAuthCookie();

  assert.equal(AUTH_COOKIE_NAME, 'aircrew_token');
});

test('authCookieOptions: maxAge = exp*1000 - now (exp a +3600 s → 3 600 000 ms ± 5000)', () => {
  const { authCookieOptions } = loadAuthCookie();
  const token = signTokenExpiringIn(3600);

  const { maxAge } = authCookieOptions(token, { now: NOW, isProduction: false });

  assert.equal(typeof maxAge, 'number');
  assert.ok(
    Math.abs(maxAge - 3600000) <= 5000,
    `maxAge esperado ≈ 3600000, obtenido ${maxAge}`
  );
});

test('authCookieOptions: secure es false sin producción', () => {
  const { authCookieOptions } = loadAuthCookie();
  const token = signTokenExpiringIn(3600);

  const options = authCookieOptions(token, { now: NOW, isProduction: false });

  assert.equal(options.secure, false);
});

test('authCookieOptions: secure es true con isProduction: true', () => {
  const { authCookieOptions } = loadAuthCookie();
  const token = signTokenExpiringIn(3600);

  const options = authCookieOptions(token, { now: NOW, isProduction: true });

  assert.equal(options.secure, true);
});

test("authCookieOptions: httpOnly true, sameSite 'lax' y path '/'", () => {
  const { authCookieOptions } = loadAuthCookie();
  const token = signTokenExpiringIn(3600);

  const options = authCookieOptions(token, { now: NOW, isProduction: false });

  assert.equal(options.httpOnly, true);
  assert.equal(options.sameSite, 'lax');
  assert.equal(options.path, '/');
});

test('clearedAuthCookieOptions: mismas opciones sin maxAge', () => {
  const { clearedAuthCookieOptions } = loadAuthCookie();

  assert.deepEqual(clearedAuthCookieOptions({ isProduction: false }), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: false,
  });
  assert.equal(clearedAuthCookieOptions({ isProduction: true }).secure, true);
});
