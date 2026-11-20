const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

// El cambio firma un token de sesión nuevo (D4). Antes de cargar config/env:
// dotenv no pisa una variable que ya existe.
process.env.JWT_SECRET = 'prueba'.repeat(4);

const SESSION_MESSAGE = 'La sesión ya no es válida.';
const DATA_MESSAGE = 'Se requieren la contraseña actual y una nueva de 12 a 72 bytes.';
const SAME_MESSAGE = 'La nueva contraseña debe ser distinta de la actual.';
const WRONG_MESSAGE = 'La contraseña actual no es correcta.';
const CHANGES_MESSAGE =
  'Ya cambiaste tu contraseña 3 veces en las últimas 24 horas. Podrás cambiarla de nuevo más tarde.';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const START = new Date('2026-11-20T12:00:00Z').getTime();
const USER_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

// Contraseñas de prueba: texto repetido, sin aspecto de secreto.
const CURRENT = 'a'.repeat(12);
const NEXT = 'b'.repeat(12);

function createClock() {
  const clock = { time: START };
  clock.now = () => new Date(clock.time);
  return clock;
}

// Hasher falso: evita bcrypt. hash espera un turno, como el real, para que
// otra petición pueda colarse entre la lectura y la escritura si no hay bloqueo.
// Anota sus llamadas en `calls`, junto a las del repositorio, para ver el orden.
function createPasswordHasher(calls) {
  return {
    async hash(value) {
      calls.push('hash');
      await new Promise((resolve) => setImmediate(resolve));
      return `hash:${value}`;
    },
    async compare(value, hash) {
      calls.push('compare');
      return hash === `hash:${value}`;
    },
  };
}

// Repositorio en memoria con el bloqueo de la cuenta imitado con una cola.
function createFakeRepository({ user, events = [], clock }) {
  const state = {
    user: user && { ...user },
    events: events.map((event) => ({ ...event })),
  };
  const calls = [];
  let lockQueue = Promise.resolve();
  let hold = null;

  async function findPasswordHash(userId) {
    calls.push('findPasswordHash');
    return state.user && state.user.id === userId
      ? { password_hash: state.user.password_hash, is_active: state.user.is_active }
      : null;
  }

  async function countPasswordResetEvents({ userId, event, since }) {
    calls.push('countPasswordResetEvents');
    return state.events.filter(
      (candidate) =>
        candidate.userId === userId && candidate.event === event && candidate.createdAt > since
    ).length;
  }

  // Como el repositorio real: leer y contar también se puede hacer fuera del bloqueo.
  const locked = {
    findPasswordHash,
    countPasswordResetEvents,
    async savePasswordChange({ userId, passwordHash }) {
      calls.push('savePasswordChange');
      state.user.password_hash = passwordHash;
      state.user.password_changed_at = clock.now();
      state.events.push({ userId, event: 'changed', createdAt: clock.now() });
      return state.user.password_changed_at;
    },
  };

  return {
    state,
    calls,
    findPasswordHash,
    countPasswordResetEvents,
    async withPasswordResetLock(userId, fn) {
      calls.push('withPasswordResetLock');
      if (hold) {
        const current = hold;
        hold = null;
        current.arrive();
        await current.released;
      }
      const run = lockQueue.then(() => fn(locked));
      lockQueue = run.catch(() => {});
      return run;
    },
    // La próxima petición que pida el bloqueo espera en la puerta hasta release().
    holdNextLock() {
      const gate = {};
      const arrived = new Promise((resolve) => {
        gate.arrive = resolve;
      });
      gate.released = new Promise((resolve) => {
        gate.release = resolve;
      });
      hold = gate;
      return { arrived, release: gate.release };
    },
  };
}

const USER = {
  id: USER_ID,
  is_active: true,
  password_hash: `hash:${CURRENT}`,
  password_changed_at: null,
};

function changedEvents(count, ago) {
  return Array.from({ length: count }, (_, index) => ({
    userId: USER_ID,
    event: 'changed',
    createdAt: new Date(START - ago - index * HOUR),
  }));
}

// El require va aquí para que, si el módulo falta, cada test falle por su cuenta.
function setup({ user = USER, events } = {}) {
  const createChangePassword = require('../src/application/use-cases/changePassword');
  const clock = createClock();
  const userRepository = createFakeRepository({ user, events, clock });
  const passwordHasher = createPasswordHasher(userRepository.calls);
  return {
    clock,
    userRepository,
    requester: { id: USER_ID, role: 'crew' },
    changePassword: createChangePassword({ userRepository, passwordHasher, now: clock.now }),
  };
}

function rejectsWith(status, message) {
  return (error) => {
    assert.equal(error.status, status);
    assert.equal(error.message, message);
    return true;
  };
}

function changedCount(context) {
  return context.userRepository.state.events.filter(({ event }) => event === 'changed').length;
}

test('CF-B3: con la contraseña actual correcta guarda el hash nuevo, actualiza password_changed_at y registra el evento changed', async () => {
  const context = setup();

  const result = await context.changePassword(context.requester, {
    current_password: CURRENT,
    new_password: NEXT,
  });

  // D4: además devuelve el token de la sesión nueva para la cookie.
  assert.deepEqual(result.password_changed_at, new Date(START));
  assert.equal(typeof result.token, 'string');
  const { user, events } = context.userRepository.state;
  assert.equal(user.password_hash, `hash:${NEXT}`);
  assert.deepEqual(user.password_changed_at, new Date(START));
  assert.deepEqual(events.map(({ event }) => event), ['changed']);
});

test('CF-B3: con la contraseña actual incorrecta responde 400 y no cambia nada', async () => {
  const context = setup();

  await assert.rejects(
    context.changePassword(context.requester, {
      current_password: 'c'.repeat(12),
      new_password: NEXT,
    }),
    rejectsWith(400, WRONG_MESSAGE)
  );
  assert.equal(context.userRepository.state.user.password_hash, `hash:${CURRENT}`);
  assert.equal(changedCount(context), 0);
});

for (const [label, input] of [
  ['con una nueva de 11 caracteres', { current_password: CURRENT, new_password: 'b'.repeat(11) }],
  // 37 caracteres, pero 74 bytes: cuenta bytes, no caracteres.
  ['con una nueva de más de 72 bytes', { current_password: CURRENT, new_password: 'ñ'.repeat(37) }],
  ['con una nueva que no es texto', { current_password: CURRENT, new_password: 123456789012 }],
  ['sin la contraseña actual', { new_password: NEXT }],
  ['con una contraseña actual vacía', { current_password: '', new_password: NEXT }],
  ['sin body', undefined],
]) {
  test(`CF-B3: ${label} responde 400 sin consultar el repositorio`, async () => {
    const context = setup();

    await assert.rejects(context.changePassword(context.requester, input), rejectsWith(400, DATA_MESSAGE));
    assert.deepEqual(context.userRepository.calls, []);
  });
}

test('CF-B3: si la nueva es igual a la actual responde 400 sin consultar el repositorio', async () => {
  const context = setup();

  await assert.rejects(
    context.changePassword(context.requester, { current_password: CURRENT, new_password: CURRENT }),
    rejectsWith(400, SAME_MESSAGE)
  );
  assert.deepEqual(context.userRepository.calls, []);
});

test('CF-B3: con 3 cambios en las últimas 24 h responde 429 y no cambia nada', async () => {
  const context = setup({ events: changedEvents(3, HOUR) });

  await assert.rejects(
    context.changePassword(context.requester, { current_password: CURRENT, new_password: NEXT }),
    rejectsWith(429, CHANGES_MESSAGE)
  );
  assert.equal(context.userRepository.state.user.password_hash, `hash:${CURRENT}`);
  assert.equal(changedCount(context), 3);
});

test('CF-B3: los cambios de hace más de 24 h no cuentan para el límite', async () => {
  const context = setup({ events: changedEvents(3, 24 * HOUR + MINUTE) });

  const result = await context.changePassword(context.requester, {
    current_password: CURRENT,
    new_password: NEXT,
  });

  // D4: además devuelve el token de la sesión nueva para la cookie.
  assert.deepEqual(result.password_changed_at, new Date(START));
  assert.equal(typeof result.token, 'string');
});

test('CF-B3: con 2 cambios permite el tercero y el cuarto responde 429', async () => {
  const context = setup({ events: changedEvents(2, HOUR) });

  await context.changePassword(context.requester, { current_password: CURRENT, new_password: NEXT });

  await assert.rejects(
    context.changePassword(context.requester, { current_password: NEXT, new_password: CURRENT }),
    rejectsWith(429, CHANGES_MESSAGE)
  );
  assert.equal(changedCount(context), 3);
});

test('CF-B3: con el límite alcanzado y la contraseña actual incorrecta, responde primero el 400', async () => {
  const context = setup({ events: changedEvents(3, HOUR) });

  await assert.rejects(
    context.changePassword(context.requester, {
      current_password: 'c'.repeat(12),
      new_password: NEXT,
    }),
    rejectsWith(400, WRONG_MESSAGE)
  );
});

test('CF-B3: con 2 cambios previos y tres peticiones a la vez, solo una cambia la contraseña', async () => {
  const context = setup({ events: changedEvents(2, HOUR) });
  const input = { current_password: CURRENT, new_password: NEXT };

  const results = await Promise.allSettled([
    context.changePassword(context.requester, input),
    context.changePassword(context.requester, input),
    context.changePassword(context.requester, input),
  ]);

  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
  // Las otras dos compararon con el hash anterior: dentro del bloqueo ya cambió.
  for (const { reason } of results.filter(({ status }) => status === 'rejected')) {
    rejectsWith(400, WRONG_MESSAGE)(reason);
  }
  assert.equal(changedCount(context), 3);
});

test('CF-B3: bcrypt corre antes del bloqueo; con la cuenta bloqueada solo se relee el hash, se cuenta y se guarda', async () => {
  const context = setup();

  await context.changePassword(context.requester, { current_password: CURRENT, new_password: NEXT });

  assert.deepEqual(context.userRepository.calls, [
    'findPasswordHash',
    'compare',
    'hash',
    'withPasswordResetLock',
    'findPasswordHash',
    'countPasswordResetEvents',
    'savePasswordChange',
  ]);
});

test('CF-B3: con la contraseña actual incorrecta no llega a bloquear la cuenta', async () => {
  const context = setup();

  await assert.rejects(
    context.changePassword(context.requester, {
      current_password: 'c'.repeat(12),
      new_password: NEXT,
    }),
    rejectsWith(400, WRONG_MESSAGE)
  );
  assert.deepEqual(context.userRepository.calls, ['findPasswordHash', 'compare']);
});

test('CF-B3: si la contraseña cambia mientras la petición espera el bloqueo, responde 400 y no guarda nada', async () => {
  const context = setup();
  const gate = context.userRepository.holdNextLock();
  const waiting = context.changePassword(context.requester, {
    current_password: CURRENT,
    new_password: 'c'.repeat(12),
  });
  await gate.arrived;

  await context.changePassword(context.requester, { current_password: CURRENT, new_password: NEXT });
  gate.release();

  await assert.rejects(waiting, rejectsWith(400, WRONG_MESSAGE));
  assert.equal(context.userRepository.state.user.password_hash, `hash:${NEXT}`);
  assert.equal(changedCount(context), 1);
});

test('CF-B3: si la cuenta se desactiva mientras la petición espera el bloqueo, responde 401 y no guarda nada', async () => {
  const context = setup();
  const gate = context.userRepository.holdNextLock();
  const waiting = context.changePassword(context.requester, {
    current_password: CURRENT,
    new_password: NEXT,
  });
  await gate.arrived;

  context.userRepository.state.user.is_active = false;
  gate.release();

  await assert.rejects(waiting, rejectsWith(401, SESSION_MESSAGE));
  assert.equal(context.userRepository.state.user.password_hash, `hash:${CURRENT}`);
  assert.equal(changedCount(context), 0);
});

test('CF-B3: con 2 cambios previos, CURRENT→NEXT y NEXT→CURRENT a la vez dejan un cambio hecho y un 429', async () => {
  const context = setup({ events: changedEvents(2, HOUR) });
  const { userRepository } = context;
  const read = userRepository.findPasswordHash;
  let reads = 0;
  // La segunda petición lee el hash cuando la primera ya terminó: compara bien y
  // llega al conteo. (La relectura dentro del bloqueo no pasa por aquí.)
  userRepository.findPasswordHash = async (userId) => {
    reads += 1;
    if (reads === 2) await first.catch(() => {});
    return read(userId);
  };

  const first = context.changePassword(context.requester, {
    current_password: CURRENT,
    new_password: NEXT,
  });
  const second = context.changePassword(context.requester, {
    current_password: NEXT,
    new_password: CURRENT,
  });

  const [firstResult, secondResult] = await Promise.allSettled([first, second]);

  assert.equal(firstResult.status, 'fulfilled');
  assert.equal(secondResult.status, 'rejected');
  rejectsWith(429, CHANGES_MESSAGE)(secondResult.reason);
  assert.equal(changedCount(context), 3);
  assert.equal(userRepository.state.user.password_hash, `hash:${NEXT}`);
});

// El conteo tiene que ir dentro del bloqueo. Con un hasher determinista, A y B dejan
// el hash como estaba mientras C espera en la puerta del bloqueo con su bcrypt hecho:
// la relectura de C no ve diferencia y solo el conteo bloqueado frena el 4.º cambio.
test('CF-B3: una petición que esperaba el bloqueo mientras se registraban el 2.º y el 3.º cambio responde 429', async () => {
  const context = setup({ events: changedEvents(1, HOUR) });
  const gate = context.userRepository.holdNextLock();
  const waiting = context.changePassword(context.requester, {
    current_password: CURRENT,
    new_password: NEXT,
  });
  await gate.arrived;

  await context.changePassword(context.requester, { current_password: CURRENT, new_password: NEXT });
  await context.changePassword(context.requester, { current_password: NEXT, new_password: CURRENT });
  gate.release();

  await assert.rejects(waiting, rejectsWith(429, CHANGES_MESSAGE));
  assert.equal(changedCount(context), 3);
  assert.equal(context.userRepository.state.user.password_hash, `hash:${CURRENT}`);
});

for (const [label, user] of [
  ['una cuenta desactivada', { ...USER, is_active: false }],
  ['una cuenta que ya no existe', null],
]) {
  test(`CF-B3: con ${label} responde 401`, async () => {
    const context = setup({ user });

    await assert.rejects(
      context.changePassword(context.requester, { current_password: CURRENT, new_password: NEXT }),
      rejectsWith(401, SESSION_MESSAGE)
    );
  });
}

test('CF-B3: con un id de sesión que no es UUID responde 401 sin consultar el repositorio', async () => {
  const context = setup();

  await assert.rejects(
    context.changePassword(
      { id: 'no-es-uuid', role: 'crew' },
      { current_password: CURRENT, new_password: NEXT }
    ),
    rejectsWith(401, SESSION_MESSAGE)
  );
  assert.deepEqual(context.userRepository.calls, []);
});

// --- Controlador ---

// Respuesta falsa de Express: guarda el estado, el body y las llamadas a cookies.
function createFakeRes() {
  const res = {
    statusCode: undefined,
    body: undefined,
    cookieCalls: [],
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(body) {
      res.body = body;
      return res;
    },
    cookie(...args) {
      res.cookieCalls.push(['cookie', ...args]);
      return res;
    },
    clearCookie(...args) {
      res.cookieCalls.push(['clearCookie', ...args]);
      return res;
    },
  };
  return res;
}

// Pasa el cambio por el controlador y, si falla, por el errorHandler real de shared.
async function changeResponse(changePassword, body) {
  const { errorHandler } = require('@vuelos/shared');
  const { createChangePasswordController } = require('../src/adapters/inbound/http/controllers/auth.controller');
  const handler = createChangePasswordController(changePassword);
  const res = createFakeRes();
  let failure;

  await handler({ user: { id: USER_ID, role: 'crew' }, body }, res, (error) => {
    failure = error;
  });
  if (failure) errorHandler(failure, {}, res, () => {});

  return res;
}

// D4-B2: antes no tocaba la cookie; ahora pone una de sesión nueva y el body no lleva el token.
test('CF-B3 (HTTP): un cambio correcto responde 200 con { password_changed_at } y pone una cookie de sesión nueva', async () => {
  const context = setup();

  const res = await changeResponse(context.changePassword, {
    current_password: CURRENT,
    new_password: NEXT,
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { password_changed_at: new Date(START) });
  assert.equal(res.cookieCalls.length, 1);
  const [method, name, value, options] = res.cookieCalls[0];
  assert.equal(method, 'cookie');
  assert.equal(name, 'aircrew_token');
  assert.equal(jwt.decode(value).sub, USER_ID);
  assert.equal(options.httpOnly, true);
  assert.equal(options.sameSite, 'lax');
  assert.equal(options.path, '/');
});

test('CF-B3 (HTTP): la contraseña actual incorrecta responde 400 con { error } y el mensaje exacto', async (t) => {
  t.mock.method(console, 'error', () => {});
  const context = setup();

  const res = await changeResponse(context.changePassword, {
    current_password: 'c'.repeat(12),
    new_password: NEXT,
  });

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: WRONG_MESSAGE });
  assert.deepEqual(res.cookieCalls, []);
});

test('CF-B3 (HTTP): con 3 cambios en 24 h responde 429 con { error } y el mensaje exacto', async (t) => {
  t.mock.method(console, 'error', () => {});
  const context = setup({ events: changedEvents(3, HOUR) });

  const res = await changeResponse(context.changePassword, {
    current_password: CURRENT,
    new_password: NEXT,
  });

  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.body, { error: CHANGES_MESSAGE });
});
