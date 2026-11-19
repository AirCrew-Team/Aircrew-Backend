const { test } = require('node:test');
const assert = require('node:assert/strict');

// Se carga dentro de cada test: si el módulo no existe, cada criterio
// falla por separado con su propio motivo.
function loadCookieAuth() {
  return require('../src/adapters/inbound/http/cookieAuth');
}

function runMiddleware(headers) {
  const { cookieToAuthorization } = loadCookieAuth();
  const req = { headers };
  let nextCalls = 0;

  cookieToAuthorization(req, {}, () => {
    nextCalls += 1;
  });

  assert.equal(nextCalls, 1, 'el middleware debe llamar a next una vez');
  return req;
}

test('readCookie lee aircrew_token entre otras cookies', () => {
  const { readCookie } = loadCookieAuth();

  assert.equal(readCookie('x=1; aircrew_token=abc; y=2', 'aircrew_token'), 'abc');
});

test('readCookie devuelve null sin cabecera Cookie', () => {
  const { readCookie } = loadCookieAuth();

  assert.equal(readCookie(undefined, 'aircrew_token'), null);
});

test('readCookie devuelve null si la cookie no está', () => {
  const { readCookie } = loadCookieAuth();

  assert.equal(readCookie('x=1; y=2', 'aircrew_token'), null);
});

test('readCookie aplica decodeURIComponent al valor', () => {
  const { readCookie } = loadCookieAuth();

  assert.equal(readCookie('aircrew_token=a%2Bb%3D', 'aircrew_token'), 'a+b=');
});

test('readCookie no confunde una cookie cuyo nombre termina igual', () => {
  const { readCookie } = loadCookieAuth();

  assert.equal(readCookie('old_aircrew_token=zzz; aircrew_token=abc', 'aircrew_token'), 'abc');
});

test('LR-B4: con cookie aircrew_token y sin Authorization, pone Bearer <valor>', () => {
  const req = runMiddleware({ cookie: 'aircrew_token=abc' });

  assert.equal(req.headers.authorization, 'Bearer abc');
});

test('LR-B4: si ya hay Authorization, se respeta aunque haya cookie', () => {
  const req = runMiddleware({ cookie: 'aircrew_token=abc', authorization: 'Bearer xyz' });

  assert.equal(req.headers.authorization, 'Bearer xyz');
});

test('LR-B4: sin cookie ni Authorization, no añade nada', () => {
  const req = runMiddleware({});

  assert.equal(req.headers.authorization, undefined);
});
