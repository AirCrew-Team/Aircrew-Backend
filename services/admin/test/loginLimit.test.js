const { test } = require('node:test');
const assert = require('node:assert/strict');

// BE-2 (D2, docs/specs/cierre-pendientes.md, frontend): 5 fallos de login por correo
// en 15 min → 429 durante el resto de la ventana, con un mensaje que no revela si la
// cuenta existe. Antes de cargar config/env: dotenv no pisa una variable que ya existe.
process.env.JWT_SECRET = 'prueba'.repeat(4);

const LIMIT_MESSAGE = 'Demasiados intentos fallidos. Espera unos minutos e intenta de nuevo.';
const CREDENTIALS_MESSAGE = 'Email o contraseña incorrectos.';

const MINUTE = 60 * 1000;
const START = new Date('2026-11-20T12:00:00Z').getTime();
const EMAIL = 'ana@aircrew.test';
// Contraseñas de prueba: texto repetido, sin aspecto de secreto.
const PASSWORD = 'a'.repeat(12);
const WRONG = 'c'.repeat(12);

const USER = {
  id: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
  name: 'Ana Pérez',
  email: EMAIL,
  role: 'crew',
  is_active: true,
  pending_activation: false,
  password_hash: `hash:${PASSWORD}`,
  password_changed_at: null,
};

// Repositorio en memoria: cuentas y fallos de login por correo. Cada operación espera
// un turno antes de leer o escribir, como una consulta real: peticiones simultáneas se
// intercalan entre la escritura y la lectura.
const ioTurn = () => new Promise((resolve) => setImmediate(resolve));

function createFakeRepository({ users = [USER], failures = [] } = {}) {
  let nextId = 0;
  const state = {
    failures: failures.map((failure) => ({ id: `previo-${(nextId += 1)}`, ...failure })),
  };
  const calls = [];
  return {
    state,
    calls,
    async findByEmail(email) {
      calls.push('findByEmail');
      await ioTurn();
      const user = users.find((candidate) => candidate.email.toLowerCase() === email.toLowerCase());
      return user ? { ...user } : null;
    },
    async countLoginFailures({ email, since }) {
      calls.push('countLoginFailures');
      await ioTurn();
      return state.failures.filter(
        (failure) => failure.email === email && failure.createdAt > since
      ).length;
    },
    async recordLoginFailure(email) {
      calls.push('recordLoginFailure');
      await ioTurn();
      const id = `intento-${(nextId += 1)}`;
      state.failures.push({ id, email, createdAt: new Date(clock.time) });
      return id;
    },
    async deleteLoginFailure(id) {
      calls.push('deleteLoginFailure');
      await ioTurn();
      state.failures = state.failures.filter((failure) => failure.id !== id);
    },
  };
}

const clock = { time: START };

function failures(count, ago, email = EMAIL) {
  return Array.from({ length: count }, (_, index) => ({
    email,
    createdAt: new Date(START - ago - index * MINUTE),
  }));
}

// El require va aquí para que, si algo falta, cada test falle por su cuenta.
function setup(options = {}) {
  const createLogin = require('../src/application/use-cases/login');
  clock.time = START;
  const userRepository = createFakeRepository(options);
  // Hashes con los que se comparó, en orden. alwaysMatches: compare responde true siempre.
  const compared = [];
  const passwordHasher = {
    async compare(value, hash) {
      userRepository.calls.push('compare');
      compared.push(hash);
      await ioTurn();
      return options.alwaysMatches === true || hash === `hash:${value}`;
    },
  };
  return {
    userRepository,
    compared,
    login: createLogin({ userRepository, passwordHasher, now: () => new Date(clock.time) }),
  };
}

function rejectsWith(status, message) {
  return (error) => {
    assert.equal(error.status, status);
    assert.equal(error.message, message);
    return true;
  };
}

test('BE-2: un login con la contraseña incorrecta registra un fallo para el correo', async () => {
  const { login, userRepository } = setup();

  await assert.rejects(login({ email: EMAIL, password: WRONG }), rejectsWith(401, CREDENTIALS_MESSAGE));

  assert.deepEqual(userRepository.state.failures.map(({ email }) => email), [EMAIL]);
});

test('BE-2: un login con un correo sin cuenta también registra el fallo', async () => {
  const { login, userRepository } = setup();

  await assert.rejects(
    login({ email: 'nadie@aircrew.test', password: WRONG }),
    rejectsWith(401, CREDENTIALS_MESSAGE)
  );

  assert.deepEqual(userRepository.state.failures.map(({ email }) => email), ['nadie@aircrew.test']);
});

test('BE-2: un login de una cuenta desactivada registra el fallo', async () => {
  const { login, userRepository } = setup({ users: [{ ...USER, is_active: false }] });

  await assert.rejects(login({ email: EMAIL, password: PASSWORD }), rejectsWith(401, CREDENTIALS_MESSAGE));

  assert.equal(userRepository.state.failures.length, 1);
});

test('BE-2: el fallo se registra con el correo normalizado (sin espacios ni mayúsculas)', async () => {
  const { login, userRepository } = setup();

  await assert.rejects(login({ email: '  Ana@AirCrew.TEST ', password: WRONG }));

  assert.deepEqual(userRepository.state.failures.map(({ email }) => email), [EMAIL]);
});

test('BE-2: con 5 fallos en 15 min responde 429 sin buscar la cuenta ni comparar', async () => {
  const { login, userRepository } = setup({ failures: failures(5, MINUTE) });

  await assert.rejects(login({ email: EMAIL, password: PASSWORD }), rejectsWith(429, LIMIT_MESSAGE));

  // Revisión final: el intento se registra antes de contar y, con el 429, se borra.
  assert.deepEqual(userRepository.calls, ['recordLoginFailure', 'countLoginFailures', 'deleteLoginFailure']);
  assert.equal(userRepository.state.failures.length, 5, 'el 429 no registra otro fallo');
});

test('BE-2: el 429 dice lo mismo exista o no la cuenta', async () => {
  const existing = setup({ failures: failures(5, MINUTE) });
  const missing = setup({ failures: failures(5, MINUTE, 'nadie@aircrew.test') });

  const errorOf = (promise) => promise.then(() => null, (error) => error);
  const a = await errorOf(existing.login({ email: EMAIL, password: WRONG }));
  const b = await errorOf(missing.login({ email: 'nadie@aircrew.test', password: WRONG }));

  assert.equal(a.status, 429);
  assert.equal(b.status, 429);
  assert.equal(a.message, b.message);
});

test('BE-2: los fallos se cuentan por correo normalizado', async () => {
  const { login } = setup({ failures: failures(5, MINUTE) });

  await assert.rejects(
    login({ email: ' ANA@aircrew.test', password: PASSWORD }),
    rejectsWith(429, LIMIT_MESSAGE)
  );
});

test('BE-2: los fallos de otro correo no cuentan', async () => {
  const { login } = setup({ failures: failures(5, MINUTE, 'otro@aircrew.test') });

  const result = await login({ email: EMAIL, password: PASSWORD });

  assert.equal(typeof result.token, 'string');
});

test('BE-2: los fallos de hace más de 15 min no cuentan', async () => {
  const { login } = setup({ failures: failures(5, 15 * MINUTE) });

  const result = await login({ email: EMAIL, password: PASSWORD });

  assert.equal(result.user.email, EMAIL);
});

test('BE-2: con 4 fallos, el quinto responde 401 y el sexto intento 429 aunque la contraseña sea correcta', async () => {
  const { login } = setup({ failures: failures(4, MINUTE) });

  await assert.rejects(login({ email: EMAIL, password: WRONG }), rejectsWith(401, CREDENTIALS_MESSAGE));
  await assert.rejects(login({ email: EMAIL, password: PASSWORD }), rejectsWith(429, LIMIT_MESSAGE));
});

test('BE-2: un login correcto no borra los fallos anteriores', async () => {
  const { login, userRepository } = setup({ failures: failures(4, MINUTE) });

  await login({ email: EMAIL, password: PASSWORD });

  assert.equal(userRepository.state.failures.length, 4);
  await assert.rejects(login({ email: EMAIL, password: WRONG }), rejectsWith(401, CREDENTIALS_MESSAGE));
  await assert.rejects(login({ email: EMAIL, password: PASSWORD }), rejectsWith(429, LIMIT_MESSAGE));
});

test('BE-2: un login sin email o sin password responde 400 sin contar ni registrar', async () => {
  const { login, userRepository } = setup();

  await assert.rejects(login({ email: EMAIL }), rejectsWith(400, 'Se requieren email y password.'));

  assert.deepEqual(userRepository.calls, []);
});

test('BE-2 (HTTP): el 429 llega con { error } y sin cookie de sesión', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { errorHandler } = require('@vuelos/shared');
  const { createLoginController } = require('../src/adapters/inbound/http/controllers/auth.controller');
  const { login } = setup({ failures: failures(5, MINUTE) });
  const handler = createLoginController(login);
  const res = {
    cookies: [],
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(body) {
      res.body = body;
      return res;
    },
    cookie(...args) {
      res.cookies.push(args);
      return res;
    },
  };
  let failure;

  await handler({ body: { email: EMAIL, password: PASSWORD } }, res, (error) => {
    failure = error;
  });
  errorHandler(failure, {}, res, () => {});

  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.body, { error: LIMIT_MESSAGE });
  assert.deepEqual(res.cookies, []);
});

// --- Revisión final: carrera en el límite, correos enormes y tiempos iguales ---

test('Revisión: 10 intentos simultáneos con la contraseña incorrecta: como mucho 5 llegan a comparar', async () => {
  const { login, userRepository } = setup();

  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () => login({ email: EMAIL, password: WRONG }))
  );

  const compares = userRepository.calls.filter((call) => call === 'compare').length;
  assert.ok(compares <= 5, `compararon ${compares}`);
  const statuses = results.map(({ reason }) => reason.status);
  assert.equal(statuses.filter((status) => status === 401).length, compares);
  assert.equal(statuses.filter((status) => status === 429).length, 10 - compares);
  // Solo quedan los fallos de verdad: los intentos con 429 se borran.
  assert.equal(userRepository.state.failures.length, compares);
});

test('Revisión: con 4 fallos, 10 intentos simultáneos dejan comparar como mucho a 1', async () => {
  const { login, userRepository } = setup({ failures: failures(4, MINUTE) });

  await Promise.allSettled(Array.from({ length: 10 }, () => login({ email: EMAIL, password: WRONG })));

  assert.ok(userRepository.calls.filter((call) => call === 'compare').length <= 1);
});

test('Revisión: el intento se registra antes de comparar y, si la contraseña es correcta, se borra', async () => {
  const { login, userRepository } = setup({ failures: failures(2, MINUTE) });

  await login({ email: EMAIL, password: PASSWORD });

  assert.deepEqual(userRepository.calls, [
    'recordLoginFailure',
    'countLoginFailures',
    'findByEmail',
    'compare',
    'deleteLoginFailure',
  ]);
  assert.equal(userRepository.state.failures.length, 2);
});

test('Revisión: un email de más de 254 caracteres responde 400 sin contar ni registrar', async () => {
  const { login, userRepository } = setup();
  const longEmail = `${'a'.repeat(243)}@aircrew.test`;
  assert.equal(longEmail.length, 256);

  await assert.rejects(login({ email: longEmail, password: WRONG }), rejectsWith(400, 'Se requieren email y password.'));

  assert.deepEqual(userRepository.calls, []);
});

test('Revisión: un email de 254 caracteres sí se procesa', async () => {
  const { login } = setup();
  const email = `${'a'.repeat(241)}@aircrew.test`;
  assert.equal(email.length, 254);

  await assert.rejects(login({ email, password: WRONG }), rejectsWith(401, CREDENTIALS_MESSAGE));
});

test('Revisión: con una cuenta inexistente compara igual contra un hash bcrypt ficticio', async () => {
  const { login, userRepository, compared } = setup();

  await assert.rejects(login({ email: 'nadie@aircrew.test', password: WRONG }), rejectsWith(401, CREDENTIALS_MESSAGE));

  assert.ok(userRepository.calls.includes('compare'));
  assert.equal(compared.length, 1);
  // Hash bcrypt de verdad con el mismo coste (10) que passwordHasher.
  assert.match(compared[0], /^\$2[aby]\$10\$[./A-Za-z0-9]{53}$/);
});

test('Revisión: con una cuenta desactivada también compara contra el hash ficticio', async () => {
  const { login, compared } = setup({ users: [{ ...USER, is_active: false }] });

  await assert.rejects(login({ email: EMAIL, password: PASSWORD }), rejectsWith(401, CREDENTIALS_MESSAGE));

  assert.equal(compared.length, 1);
  assert.notEqual(compared[0], USER.password_hash);
});

test('Revisión: aunque el hash ficticio coincidiera, una cuenta inexistente no entra', async () => {
  const { login } = setup({ alwaysMatches: true });

  await assert.rejects(login({ email: 'nadie@aircrew.test', password: WRONG }), rejectsWith(401, CREDENTIALS_MESSAGE));
});

test('Revisión: el hash ficticio es un hash bcrypt válido (bcryptjs lo compara sin error)', async () => {
  const bcrypt = require('bcryptjs');
  const { TIMING_HASH } = require('../src/application/use-cases/login');

  assert.equal(await bcrypt.compare(WRONG, TIMING_HASH), false);
  assert.equal(bcrypt.getRounds(TIMING_HASH), 10);
});
