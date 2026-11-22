const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

// `secure` depende de NODE_ENV: fuera de producción debe ser false.
// Se borra antes del require por si el módulo lo lee al cargarse.
delete process.env.NODE_ENV;

const {
  createLoginController,
  createLogoutController,
} = require('../src/adapters/inbound/http/controllers/auth.controller');

// Respuesta falsa de Express: registra cada llamada en orden y encadena.
function createFakeRes() {
  const calls = [];
  const res = {
    calls,
    statusCode: undefined,
    status(code) {
      calls.push(['status', code]);
      res.statusCode = code;
      return res;
    },
    sendStatus(code) {
      calls.push(['sendStatus', code]);
      res.statusCode = code;
      return res;
    },
    json(body) {
      calls.push(['json', body]);
      return res;
    },
    send(body) {
      calls.push(['send', body]);
      return res;
    },
    end() {
      calls.push(['end']);
      return res;
    },
    cookie(name, value, options) {
      calls.push(['cookie', name, value, options]);
      return res;
    },
    clearCookie(name, options) {
      calls.push(['clearCookie', name, options]);
      return res;
    },
  };
  return res;
}

function callsOf(res, method) {
  return res.calls.filter(([name]) => name === method);
}

function createNext() {
  const errors = [];
  const next = (error) => errors.push(error);
  next.errors = errors;
  return next;
}

const token = jwt.sign(
  { role: 'crew', exp: Math.floor(Date.now() / 1000) + 3600 },
  'secreto-de-prueba',
  { subject: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b' }
);
const loginResult = {
  user: {
    id: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
    name: 'Ana Pérez',
    email: 'ana@aircrew.test',
    role: 'crew',
  },
  token,
};

test('LR-B1: un login correcto pone la cookie aircrew_token y responde 200 con { user, token }', async () => {
  const handler = createLoginController(async () => loginResult);
  const res = createFakeRes();
  const next = createNext();

  await handler({ body: { email: 'ana@aircrew.test', password: 'x' } }, res, next);

  const cookies = callsOf(res, 'cookie');
  assert.equal(cookies.length, 1, 'res.cookie debe llamarse una vez');
  const [, name, value, options] = cookies[0];
  assert.equal(name, 'aircrew_token');
  assert.equal(value, token);
  assert.equal(options.httpOnly, true);
  assert.equal(options.sameSite, 'lax');
  assert.equal(options.path, '/');
  assert.equal(options.secure, false);
  assert.ok(
    Math.abs(options.maxAge - 3600000) <= 5000,
    `maxAge esperado ≈ 3600000, obtenido ${options.maxAge}`
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(callsOf(res, 'json'), [['json', loginResult]]);
  // Las cabeceras no se pueden poner después de enviar el body.
  const cookieIndex = res.calls.findIndex(([n]) => n === 'cookie');
  const jsonIndex = res.calls.findIndex(([n]) => n === 'json');
  assert.ok(cookieIndex < jsonIndex, 'res.cookie debe ir antes de res.json');
  assert.equal(next.errors.length, 0);
});

test('LR-B2: si login lanza un 401, no se pone la cookie y el error llega a next', async () => {
  const error = new Error('Email o contraseña incorrectos.');
  error.status = 401;
  const handler = createLoginController(async () => {
    throw error;
  });
  const res = createFakeRes();
  const next = createNext();

  await handler({ body: { email: 'ana@aircrew.test', password: 'mala' } }, res, next);

  assert.equal(callsOf(res, 'cookie').length, 0, 'res.cookie no debe llamarse');
  assert.deepEqual(next.errors, [error]);
});

const expectedClearOptions = {
  path: '/',
  sameSite: 'lax',
  httpOnly: true,
  secure: false,
};

for (const [label, headers] of [
  ['con cookie', { cookie: `aircrew_token=${token}` }],
  ['sin cookie', {}],
]) {
  test(`LR-B3: logout borra la cookie aircrew_token y responde 204 (${label})`, async () => {
    assert.equal(
      typeof createLogoutController,
      'function',
      'auth.controller.js debe exportar createLogoutController'
    );
    const handler = createLogoutController();
    const res = createFakeRes();
    const next = createNext();

    await handler({ headers, cookies: undefined }, res, next);

    assert.deepEqual(callsOf(res, 'clearCookie'), [
      ['clearCookie', 'aircrew_token', expectedClearOptions],
    ]);
    assert.equal(res.statusCode, 204);
    const finished = res.calls.some(([n]) =>
      ['end', 'send', 'sendStatus', 'json'].includes(n)
    );
    assert.ok(finished, 'la respuesta debe enviarse (end, send o sendStatus)');
    assert.equal(next.errors.length, 0);
  });
}

test('LR-B3 (ruta): POST /logout de auth.routes responde 204 con un Set-Cookie que borra aircrew_token', async () => {
  // Se carga aquí: el router arrastra el repositorio, pero el Pool de pg
  // no se conecta hasta la primera consulta, y /logout no consulta nada.
  const express = require('express');
  const authRoutes = require('../src/adapters/inbound/http/routes/auth.routes');
  const app = express();
  app.use('/auth', authRoutes);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/auth/logout`, {
      method: 'POST',
    });

    assert.equal(response.status, 204);
    const setCookie = response.headers.get('set-cookie') || '';
    assert.match(setCookie, /^aircrew_token=;/);
    assert.match(setCookie, /Path=\//);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /Max-Age=0|Expires=Thu, 01 Jan 1970/);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
