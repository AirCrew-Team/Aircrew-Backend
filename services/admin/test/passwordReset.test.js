const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const createRequestPasswordReset = require('../src/application/use-cases/requestPasswordReset');
const createResetPassword = require('../src/application/use-cases/resetPassword');
const {
  createForgotPasswordController,
  createResetPasswordController,
  createCheckResetTokenController,
} = require('../src/adapters/inbound/http/controllers/auth.controller');

const GENERIC_MESSAGE =
  'Si el correo corresponde a una cuenta activa, te enviamos un enlace para restablecer la contraseña.';
const CHANGES_MESSAGE =
  'Ya cambiaste tu contraseña 3 veces en las últimas 24 horas. Podrás cambiarla de nuevo más tarde.';
const WAIT_MESSAGE =
  'Ya te enviamos un enlace hace poco. Revisa tu correo (también la carpeta de spam) o espera 2 minutos para pedir otro.';
const REQUESTS_MESSAGE =
  'Alcanzaste el límite de 5 solicitudes en 24 horas. Intenta de nuevo más tarde.';
const MISSING_DATA_MESSAGE =
  'Se requieren el token y una contraseña de 12 a 72 bytes.';
const INVALID_LINK_MESSAGE =
  'El enlace para restablecer la contraseña no es válido o ya venció.';
const EMAIL_UNAVAILABLE_MESSAGE =
  'El servicio de correo no está disponible. Intenta más tarde.';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const START = new Date('2026-11-19T12:00:00Z').getTime();

// Contraseñas de prueba: texto repetido, sin aspecto de secreto.
const VALID = 'a'.repeat(12);

const USER = {
  id: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
  name: 'Ana Pérez',
  email: 'ana@aircrew.test',
  role: 'crew',
  is_active: true,
  pending_activation: false,
  password_hash: 'hash-anterior',
  password_reset_token_hash: null,
  password_reset_expires_at: null,
};

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// Reloj que el test adelanta a mano.
function createClock() {
  const clock = { time: START };
  clock.now = () => new Date(clock.time);
  clock.advance = (ms) => {
    clock.time += ms;
  };
  return clock;
}

// Repositorio en memoria: guarda usuarios y eventos, sin PostgreSQL.
// Cuenta los eventos desde la fecha que le pide el caso de uso.
function createFakeRepository({ users = [USER], events = [], clock }) {
  const state = {
    users: users.map((user) => ({ ...user })),
    events: events.map((event) => ({ ...event })),
  };
  const calls = [];
  // Imita el FOR UPDATE: las funciones con la cuenta bloqueada corren en fila.
  let lockQueue = Promise.resolve();

  function record(name) {
    calls.push(name);
  }

  const repository = {
    state,
    calls,
    async withPasswordResetLock(userId, fn) {
      record('withPasswordResetLock');
      const run = lockQueue.then(() => fn(repository));
      lockQueue = run.catch(() => {});
      return run;
    },
    async findByEmail(email) {
      record('findByEmail');
      const user = state.users.find((candidate) => candidate.email === email);
      return user ? { ...user } : null;
    },
    async savePasswordResetToken({ userId, tokenHash, expiresAt }) {
      record('savePasswordResetToken');
      const user = state.users.find((candidate) => candidate.id === userId);
      user.password_reset_token_hash = tokenHash;
      user.password_reset_expires_at = expiresAt;
      state.events.push({ userId, event: 'requested', createdAt: clock.now() });
    },
    async countPasswordResetEvents({ userId, event, since }) {
      record('countPasswordResetEvents');
      return state.events.filter(
        (candidate) =>
          candidate.userId === userId &&
          candidate.event === event &&
          candidate.createdAt > since
      ).length;
    },
    async findByPasswordResetToken(tokenHash) {
      record('findByPasswordResetToken');
      const user = state.users.find(
        (candidate) => candidate.password_reset_token_hash === tokenHash
      );
      return user ? { ...user } : null;
    },
    async resetPasswordByToken({ tokenHash, passwordHash }) {
      record('resetPasswordByToken');
      const user = state.users.find(
        (candidate) => candidate.password_reset_token_hash === tokenHash
      );
      if (!user) return null;
      user.password_hash = passwordHash;
      user.password_reset_token_hash = null;
      user.password_reset_expires_at = null;
      state.events.push({ userId: user.id, event: 'changed', createdAt: clock.now() });
      return { id: user.id, name: user.name, email: user.email, role: user.role };
    },
    // Cambio con sesión: como el UPDATE real, también anula el token pendiente.
    async findPasswordHash(userId) {
      record('findPasswordHash');
      const user = state.users.find((candidate) => candidate.id === userId);
      return user ? { password_hash: user.password_hash, is_active: user.is_active } : null;
    },
    async savePasswordChange({ userId, passwordHash }) {
      record('savePasswordChange');
      const user = state.users.find((candidate) => candidate.id === userId);
      user.password_hash = passwordHash;
      user.password_reset_token_hash = null;
      user.password_reset_expires_at = null;
      state.events.push({ userId, event: 'changed', createdAt: clock.now() });
      return clock.now();
    },
  };

  return repository;
}

function createFakeEmailClient({ configError, sendError } = {}) {
  const sent = [];
  const calls = { check: 0 };
  return {
    sent,
    calls,
    checkPasswordResetConfig() {
      calls.check += 1;
      if (configError) throw configError;
    },
    async sendPasswordReset(message) {
      sent.push(message);
      if (sendError) throw sendError;
    },
  };
}

// Hasher falso: evita bcrypt en los tests.
const passwordHasher = { hash: async (value) => `hash:${value}` };

function setup({ users, events, emailOptions } = {}) {
  const clock = createClock();
  const userRepository = createFakeRepository({ users, events, clock });
  const emailClient = createFakeEmailClient(emailOptions);
  const background = [];
  const requestPasswordReset = createRequestPasswordReset({
    userRepository,
    emailClient,
    now: clock.now,
    runInBackground: (task) => background.push(task),
  });
  const resetPassword = createResetPassword({
    userRepository,
    passwordHasher,
    now: clock.now,
  });

  return {
    clock,
    userRepository,
    emailClient,
    requestPasswordReset,
    resetPassword,
    // Ejecuta las tareas de envío que quedaron en segundo plano.
    flush: () => Promise.all(background.splice(0).map((task) => task())),
    background,
  };
}

// Pide un enlace y devuelve el token sin hashear que llegó por correo.
async function requestToken(context) {
  await context.requestPasswordReset({ email: USER.email });
  await context.flush();
  return context.emailClient.sent.at(-1).token;
}

function events(count, { userId = USER.id, event, ago, spacing = 3 * MINUTE }) {
  return Array.from({ length: count }, (_, index) => ({
    userId,
    event,
    createdAt: new Date(START - ago - index * spacing),
  }));
}

function rejectsWith(status, message) {
  return (error) => {
    assert.equal(error.status, status);
    assert.equal(error.message, message);
    return true;
  };
}

function savedUser(context) {
  return context.userRepository.state.users.find((user) => user.id === USER.id);
}

// --- POST /auth/forgot-password ---

test('PR-B1: con el correo de una cuenta activa, en cualquier mayúscula, guarda el hash del token, registra el evento y envía el correo', async () => {
  const context = setup();

  const result = await context.requestPasswordReset({ email: '  Ana@AirCrew.TEST ' });
  await context.flush();

  assert.deepEqual(result, { message: GENERIC_MESSAGE });
  assert.equal(context.emailClient.sent.length, 1);
  const [message] = context.emailClient.sent;
  assert.equal(message.email, USER.email);
  assert.equal(message.name, USER.name);
  assert.equal(typeof message.token, 'string');
  assert.ok(message.token.length >= 32, 'el token debe ser aleatorio y largo');

  const user = savedUser(context);
  assert.notEqual(user.password_reset_token_hash, message.token);
  assert.equal(user.password_reset_token_hash, sha256(message.token));
  assert.equal(user.password_reset_expires_at.getTime(), START + 10 * MINUTE);
  assert.deepEqual(
    context.userRepository.state.events.map(({ event }) => event),
    ['requested']
  );
});

test('PR-B1: responde antes de enviar el correo, que queda en segundo plano', async () => {
  const context = setup();

  const result = await context.requestPasswordReset({ email: USER.email });

  assert.deepEqual(result, { message: GENERIC_MESSAGE });
  assert.equal(context.emailClient.sent.length, 0);
  assert.equal(context.background.length, 1);
});

for (const [label, users] of [
  ['un correo inexistente', []],
  ['una cuenta desactivada', [{ ...USER, is_active: false }]],
  [
    'una cuenta pendiente de activación',
    [{ ...USER, is_active: false, pending_activation: true }],
  ],
  // Una cuenta activa no debería tener activación pendiente, pero tampoco se recupera.
  ['una cuenta activa con activación pendiente', [{ ...USER, pending_activation: true }]],
]) {
  test(`PR-B2: con ${label} responde el mensaje genérico y no envía nada`, async () => {
    const context = setup({ users });

    const result = await context.requestPasswordReset({ email: USER.email });
    await context.flush();

    assert.deepEqual(result, { message: GENERIC_MESSAGE });
    assert.equal(context.emailClient.sent.length, 0);
    assert.equal(context.background.length, 0);
    assert.ok(!context.userRepository.calls.includes('savePasswordResetToken'));
    assert.equal(context.userRepository.state.events.length, 0);
  });
}

for (const email of [undefined, null, 42, '', '   ']) {
  test(`Contrato: forgot-password con email ${JSON.stringify(email)} responde 400 sin consultar nada`, async () => {
    const context = setup();

    await assert.rejects(context.requestPasswordReset({ email }), (error) => {
      assert.equal(error.status, 400);
      return true;
    });
    assert.deepEqual(context.userRepository.calls, []);
  });
}

test('PR-B3: con una solicitud hace menos de 2 minutos responde 429 con el mensaje de espera, sin token nuevo ni correo', async () => {
  const context = setup();
  await requestToken(context);
  const firstHash = savedUser(context).password_reset_token_hash;
  context.clock.advance(2 * MINUTE - 1000);

  await assert.rejects(
    context.requestPasswordReset({ email: USER.email }),
    rejectsWith(429, WAIT_MESSAGE)
  );
  await context.flush();

  assert.equal(savedUser(context).password_reset_token_hash, firstHash);
  assert.equal(context.emailClient.sent.length, 1);
  assert.equal(context.userRepository.state.events.length, 1);
});

test('PR-B3: pasados 2 minutos se puede pedir otro enlace y el anterior deja de valer', async () => {
  const context = setup();
  const firstToken = await requestToken(context);
  context.clock.advance(2 * MINUTE + 1000);

  const secondToken = await requestToken(context);

  assert.notEqual(secondToken, firstToken);
  assert.equal(savedUser(context).password_reset_token_hash, sha256(secondToken));
  await assert.rejects(
    context.resetPassword({ token: firstToken, password: VALID }),
    rejectsWith(400, INVALID_LINK_MESSAGE)
  );
});

test('PR-B3: dos solicitudes simultáneas de la misma cuenta dejan un solo token y un solo correo; la otra responde 429 de espera', async () => {
  const context = setup();

  const results = await Promise.allSettled([
    context.requestPasswordReset({ email: USER.email }),
    context.requestPasswordReset({ email: USER.email }),
  ]);
  await context.flush();

  const fulfilled = results.filter(({ status }) => status === 'fulfilled');
  const rejected = results.filter(({ status }) => status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.deepEqual(fulfilled[0].value, { message: GENERIC_MESSAGE });
  assert.equal(rejected.length, 1);
  rejectsWith(429, WAIT_MESSAGE)(rejected[0].reason);

  assert.equal(context.emailClient.sent.length, 1);
  assert.equal(
    savedUser(context).password_reset_token_hash,
    sha256(context.emailClient.sent[0].token)
  );
  assert.deepEqual(
    context.userRepository.state.events.map(({ event }) => event),
    ['requested']
  );
});

test('PR-B3b: con 5 solicitudes en las últimas 24 h responde 429 con el mensaje de solicitudes', async () => {
  const context = setup({
    events: events(5, { event: 'requested', ago: 10 * MINUTE, spacing: 2 * HOUR }),
  });

  await assert.rejects(
    context.requestPasswordReset({ email: USER.email }),
    rejectsWith(429, REQUESTS_MESSAGE)
  );
  await context.flush();

  assert.equal(context.emailClient.sent.length, 0);
  assert.equal(savedUser(context).password_reset_token_hash, null);
});

test('PR-B3c: con 3 cambios en las últimas 24 h responde 429 con el mensaje de cambios, antes que los otros límites', async () => {
  const context = setup({
    events: [
      ...events(3, { event: 'changed', ago: HOUR, spacing: HOUR }),
      // También se cumplen los otros dos límites: una solicitud reciente y 5 en el día.
      ...events(5, { event: 'requested', ago: MINUTE, spacing: HOUR }),
    ],
  });

  await assert.rejects(
    context.requestPasswordReset({ email: USER.email }),
    rejectsWith(429, CHANGES_MESSAGE)
  );
  await context.flush();

  assert.equal(context.emailClient.sent.length, 0);
  assert.equal(savedUser(context).password_reset_token_hash, null);
});

test('PR-B3c: la espera de 2 minutos se revisa antes que el límite de 5 solicitudes', async () => {
  const context = setup({
    events: events(5, { event: 'requested', ago: MINUTE, spacing: HOUR }),
  });

  await assert.rejects(
    context.requestPasswordReset({ email: USER.email }),
    rejectsWith(429, WAIT_MESSAGE)
  );
});

test('PR-B3d: las solicitudes y los cambios de hace más de 24 h no cuentan', async () => {
  const context = setup({
    events: [
      ...events(3, { event: 'changed', ago: 24 * HOUR + MINUTE }),
      ...events(5, { event: 'requested', ago: 24 * HOUR + MINUTE }),
    ],
  });

  const result = await context.requestPasswordReset({ email: USER.email });
  await context.flush();

  assert.deepEqual(result, { message: GENERIC_MESSAGE });
  assert.equal(context.emailClient.sent.length, 1);
});

test('PR-B4: si el envío falla, la respuesta sigue siendo la genérica y el error queda en el log', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  const sendError = new Error('fallo del proveedor de correo');
  const context = setup({ emailOptions: { sendError } });

  const result = await context.requestPasswordReset({ email: USER.email });
  await context.flush();

  assert.deepEqual(result, { message: GENERIC_MESSAGE });
  assert.equal(context.emailClient.sent.length, 1);
  assert.equal(log.mock.callCount(), 1);
  assert.ok(log.mock.calls[0].arguments.includes(sendError));
});

test('PR-B5: si falta la configuración del correo o de PASSWORD_RESET_URL responde 503 genérico antes de buscar la cuenta y deja el detalle en el log', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  const configError = new Error('Debe configurarse PASSWORD_RESET_URL.');
  configError.status = 503;
  const context = setup({ emailOptions: { configError } });

  // La ruta es pública: el mensaje no nombra variables de entorno.
  await assert.rejects(
    context.requestPasswordReset({ email: USER.email }),
    rejectsWith(503, EMAIL_UNAVAILABLE_MESSAGE)
  );

  assert.equal(log.mock.callCount(), 1);
  assert.ok(log.mock.calls[0].arguments.includes(configError));
  assert.equal(context.emailClient.calls.check, 1);
  assert.deepEqual(context.userRepository.calls, []);
  assert.equal(context.emailClient.sent.length, 0);
});

test('PR-B1 (controlador): forgot-password responde 200 con el resultado del caso de uso', async () => {
  const handler = createForgotPasswordController(async () => ({ message: GENERIC_MESSAGE }));
  const res = createFakeRes();
  const errors = [];

  await handler({ body: { email: USER.email } }, res, (error) => errors.push(error));

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { message: GENERIC_MESSAGE });
  assert.deepEqual(errors, []);
});

// Pasa la petición por el controlador y, si falla, por el errorHandler real de shared.
async function forgotPasswordResponse(requestPasswordReset, body) {
  const { errorHandler } = require('@vuelos/shared');
  const handler = createForgotPasswordController(requestPasswordReset);
  const res = createFakeRes();
  let failure;

  await handler({ body }, res, (error) => {
    failure = error;
  });
  if (failure) errorHandler(failure, {}, res, () => {});

  return res;
}

test('PR-B3 (HTTP): el límite de espera responde 429 con { error } y el mensaje exacto', async (t) => {
  t.mock.method(console, 'error', () => {});
  const context = setup({ events: events(1, { event: 'requested', ago: MINUTE }) });

  const res = await forgotPasswordResponse(context.requestPasswordReset, {
    email: USER.email,
  });

  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.body, { error: WAIT_MESSAGE });
});

test('PR-B5 (HTTP): sin configuración del correo responde 503 con { error } genérico, sin el detalle', async (t) => {
  t.mock.method(console, 'error', () => {});
  const configError = new Error('Debe configurarse PASSWORD_RESET_URL.');
  configError.status = 503;
  const context = setup({ emailOptions: { configError } });

  const res = await forgotPasswordResponse(context.requestPasswordReset, {
    email: USER.email,
  });

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: EMAIL_UNAVAILABLE_MESSAGE });
});

// --- POST /auth/reset-password ---

test('PR-B6: con un token válido guarda el hash de la contraseña nueva, borra el token, registra el cambio y devuelve la cuenta', async () => {
  const context = setup();
  const token = await requestToken(context);
  context.clock.advance(5 * MINUTE);

  const result = await context.resetPassword({ token, password: VALID });

  assert.deepEqual(result, {
    id: USER.id,
    name: USER.name,
    email: USER.email,
    role: USER.role,
  });
  const user = savedUser(context);
  assert.equal(user.password_hash, `hash:${VALID}`);
  assert.equal(user.password_reset_token_hash, null);
  assert.equal(user.password_reset_expires_at, null);
  assert.deepEqual(
    context.userRepository.state.events.map(({ event }) => event),
    ['requested', 'changed']
  );
});

test('PR-B6 (controlador): reset-password responde 200 con el mensaje y la cuenta, sin cookie de sesión', async () => {
  const user = { id: USER.id, name: USER.name, email: USER.email, role: USER.role };
  const handler = createResetPasswordController(async () => user);
  const res = createFakeRes();
  const errors = [];

  await handler({ body: { token: 'token-de-prueba', password: VALID } }, res, (error) =>
    errors.push(error)
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    message: 'Contraseña actualizada. Ya puedes iniciar sesión.',
    user,
  });
  assert.equal(res.cookies.length, 0);
  assert.deepEqual(errors, []);
});

test('PR-B6b: con 3 cambios en 24 h, un token válido responde 429 con el mensaje de cambios y no cambia la contraseña', async () => {
  const context = setup();
  const token = await requestToken(context);
  context.userRepository.state.events.push(
    ...events(3, { event: 'changed', ago: HOUR, spacing: HOUR })
  );

  await assert.rejects(
    context.resetPassword({ token, password: VALID }),
    rejectsWith(429, CHANGES_MESSAGE)
  );

  assert.equal(savedUser(context).password_hash, USER.password_hash);
  assert.ok(!context.userRepository.calls.includes('resetPasswordByToken'));
});

test('PR-B6c: un token de hace más de 10 minutos responde 400', async () => {
  const context = setup();
  const token = await requestToken(context);
  context.clock.advance(10 * MINUTE + 1000);

  await assert.rejects(
    context.resetPassword({ token, password: VALID }),
    rejectsWith(400, INVALID_LINK_MESSAGE)
  );
  assert.equal(savedUser(context).password_hash, USER.password_hash);
});

test('PR-B6c: un token de hace menos de 10 minutos todavía sirve', async () => {
  const context = setup();
  const token = await requestToken(context);
  context.clock.advance(10 * MINUTE - 1000);

  const result = await context.resetPassword({ token, password: VALID });

  assert.equal(result.id, USER.id);
});

test('PR-B7: un token inexistente responde 400 con el mensaje del contrato', async () => {
  const context = setup();
  await requestToken(context);

  await assert.rejects(
    context.resetPassword({ token: 'token-de-prueba', password: VALID }),
    rejectsWith(400, INVALID_LINK_MESSAGE)
  );
});

test('PR-B7: un token ya usado responde 400', async () => {
  const context = setup();
  const token = await requestToken(context);
  await context.resetPassword({ token, password: VALID });

  await assert.rejects(
    context.resetPassword({ token, password: `${VALID}x` }),
    rejectsWith(400, INVALID_LINK_MESSAGE)
  );
  assert.equal(savedUser(context).password_hash, `hash:${VALID}`);
});

test('PR-B7: un token de una cuenta desactivada después de pedirlo responde 400', async () => {
  const context = setup();
  const token = await requestToken(context);
  savedUser(context).is_active = false;

  await assert.rejects(
    context.resetPassword({ token, password: VALID }),
    rejectsWith(400, INVALID_LINK_MESSAGE)
  );
  assert.equal(savedUser(context).password_hash, USER.password_hash);
});

test('PR-B7: si el token se consume entre la consulta y el cambio, responde 400', async () => {
  const context = setup();
  const token = await requestToken(context);
  context.userRepository.resetPasswordByToken = async () => null;

  await assert.rejects(
    context.resetPassword({ token, password: VALID }),
    rejectsWith(400, INVALID_LINK_MESSAGE)
  );
});

test('PR-B7: después de cambiar la contraseña con sesión, el enlace pedido antes ya no sirve', async () => {
  const createChangePassword = require('../src/application/use-cases/changePassword');
  const context = setup({ users: [{ ...USER, password_hash: `hash:${VALID}` }] });
  const token = await requestToken(context);
  const changePassword = createChangePassword({
    userRepository: context.userRepository,
    passwordHasher: { ...passwordHasher, compare: async (value, hash) => hash === `hash:${value}` },
    now: context.clock.now,
  });
  await changePassword(
    { id: USER.id, role: USER.role },
    { current_password: VALID, new_password: 'b'.repeat(12) }
  );

  await assert.rejects(
    context.resetPassword({ token, password: 'c'.repeat(12) }),
    rejectsWith(400, INVALID_LINK_MESSAGE)
  );
  assert.equal(savedUser(context).password_hash, `hash:${'b'.repeat(12)}`);
  assert.equal(
    context.userRepository.state.events.filter(({ event }) => event === 'changed').length,
    1
  );
});

for (const [label, input] of [
  ['con una contraseña de menos de 12 caracteres', { token: 'token-de-prueba', password: 'a'.repeat(11) }],
  // 37 caracteres, pero 74 bytes: cuenta bytes, no caracteres.
  ['con una contraseña de más de 72 bytes', { token: 'token-de-prueba', password: 'ñ'.repeat(37) }],
  ['con una contraseña que no es texto', { token: 'token-de-prueba', password: 123456789012 }],
  ['sin token', { password: VALID }],
  ['con un token vacío', { token: '  ', password: VALID }],
  ['sin body', undefined],
]) {
  test(`PR-B8: ${label} responde 400 sin consultar el repositorio`, async () => {
    const context = setup();

    await assert.rejects(context.resetPassword(input), rejectsWith(400, MISSING_DATA_MESSAGE));
    assert.deepEqual(context.userRepository.calls, []);
  });
}

// --- POST /auth/reset-password/check ---

// Igual que setup, más la comprobación del enlace. El require va aquí para que,
// si el módulo falta, solo fallen los tests de esta sección.
function setupCheck(options) {
  const context = setup(options);
  const createCheckResetToken = require('../src/application/use-cases/checkResetToken');
  context.checkResetToken = createCheckResetToken({
    userRepository: context.userRepository,
    now: context.clock.now,
  });
  return context;
}

test('PR-B10: con un token válido responde { valid: true } sin gastar el token ni registrar eventos', async () => {
  const context = setupCheck();
  const token = await requestToken(context);
  const before = { ...savedUser(context) };
  context.clock.advance(5 * MINUTE);

  const result = await context.checkResetToken({ token });

  assert.deepEqual(result, { valid: true });
  const user = savedUser(context);
  assert.equal(user.password_reset_token_hash, before.password_reset_token_hash);
  assert.equal(user.password_reset_expires_at, before.password_reset_expires_at);
  assert.equal(user.password_hash, USER.password_hash);
  assert.deepEqual(
    context.userRepository.state.events.map(({ event }) => event),
    ['requested']
  );
  assert.ok(!context.userRepository.calls.includes('resetPasswordByToken'));
});

test('PR-B10: después de la comprobación, el mismo token sigue sirviendo para cambiar la contraseña', async () => {
  const context = setupCheck();
  const token = await requestToken(context);

  await context.checkResetToken({ token });
  const result = await context.resetPassword({ token, password: VALID });

  assert.equal(result.id, USER.id);
  assert.equal(savedUser(context).password_hash, `hash:${VALID}`);
});

test('PR-B11: un token inexistente responde 400 con el mensaje del contrato', async () => {
  const context = setupCheck();
  await requestToken(context);

  await assert.rejects(
    context.checkResetToken({ token: 'token-de-prueba' }),
    rejectsWith(400, INVALID_LINK_MESSAGE)
  );
});

test('PR-B11: un token de hace más de 10 minutos responde 400', async () => {
  const context = setupCheck();
  const token = await requestToken(context);
  context.clock.advance(10 * MINUTE + 1000);

  await assert.rejects(
    context.checkResetToken({ token }),
    rejectsWith(400, INVALID_LINK_MESSAGE)
  );
});

test('PR-B11: un token ya usado responde 400', async () => {
  const context = setupCheck();
  const token = await requestToken(context);
  await context.resetPassword({ token, password: VALID });

  await assert.rejects(
    context.checkResetToken({ token }),
    rejectsWith(400, INVALID_LINK_MESSAGE)
  );
});

test('PR-B11: un token de una cuenta desactivada después de pedirlo responde 400', async () => {
  const context = setupCheck();
  const token = await requestToken(context);
  savedUser(context).is_active = false;

  await assert.rejects(
    context.checkResetToken({ token }),
    rejectsWith(400, INVALID_LINK_MESSAGE)
  );
});

for (const [label, input] of [
  ['sin token', {}],
  ['con un token null', { token: null }],
  ['con un token que no es texto', { token: 42 }],
  ['con un token vacío', { token: '' }],
  ['con un token de espacios', { token: '  ' }],
  ['sin body', undefined],
]) {
  test(`PR-B11: ${label} responde 400 con el mensaje del contrato sin consultar el repositorio`, async () => {
    const context = setupCheck();

    await assert.rejects(
      context.checkResetToken(input),
      rejectsWith(400, INVALID_LINK_MESSAGE)
    );
    assert.deepEqual(context.userRepository.calls, []);
  });
}

test('PR-B12: con 3 cambios en 24 h, un token válido responde 429 con el mensaje de cambios sin registrar eventos', async () => {
  const context = setupCheck();
  const token = await requestToken(context);
  context.userRepository.state.events.push(
    ...events(3, { event: 'changed', ago: HOUR, spacing: HOUR })
  );
  const eventCount = context.userRepository.state.events.length;

  await assert.rejects(
    context.checkResetToken({ token }),
    rejectsWith(429, CHANGES_MESSAGE)
  );

  assert.equal(context.userRepository.state.events.length, eventCount);
  assert.equal(savedUser(context).password_reset_token_hash, sha256(token));
});

test('PR-B10 (controlador): check responde 200 con { valid: true }', async () => {
  const handler = createCheckResetTokenController(async () => ({ valid: true }));
  const res = createFakeRes();
  const errors = [];

  await handler({ body: { token: 'token-de-prueba' } }, res, (error) => errors.push(error));

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { valid: true });
  assert.deepEqual(errors, []);
});

// Pasa la comprobación por el controlador y, si falla, por el errorHandler real de shared.
async function checkResponse(checkResetToken, body) {
  const { errorHandler } = require('@vuelos/shared');
  const handler = createCheckResetTokenController(checkResetToken);
  const res = createFakeRes();
  let failure;

  await handler({ body }, res, (error) => {
    failure = error;
  });
  if (failure) errorHandler(failure, {}, res, () => {});

  return res;
}

test('PR-B11 (HTTP): un enlace vencido responde 400 con { error } y el mensaje exacto', async (t) => {
  t.mock.method(console, 'error', () => {});
  const context = setupCheck();
  const token = await requestToken(context);
  context.clock.advance(10 * MINUTE + 1000);

  const res = await checkResponse(context.checkResetToken, { token });

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: INVALID_LINK_MESSAGE });
});

test('PR-B12 (HTTP): con 3 cambios en 24 h responde 429 con { error } y el mensaje exacto', async (t) => {
  t.mock.method(console, 'error', () => {});
  const context = setupCheck();
  const token = await requestToken(context);
  context.userRepository.state.events.push(
    ...events(3, { event: 'changed', ago: HOUR, spacing: HOUR })
  );

  const res = await checkResponse(context.checkResetToken, { token });

  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.body, { error: CHANGES_MESSAGE });
});

// Respuesta falsa de Express: guarda el estado, el body y las cookies.
function createFakeRes() {
  const res = {
    statusCode: undefined,
    body: undefined,
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
  return res;
}

// --- Rutas ---

test('PR-B8 (ruta): /auth/forgot-password y /auth/reset-password son públicas y validan el body sin consultar la base', async (t) => {
  t.mock.method(console, 'error', () => {});
  // Igual que LR-B3: el Pool de pg no se conecta hasta la primera consulta,
  // y un body inválido responde 400 antes de consultar.
  const express = require('express');
  const { errorHandler } = require('@vuelos/shared');
  const authRoutes = require('../src/adapters/inbound/http/routes/auth.routes');
  const app = express();
  app.use(express.json());
  app.use('/auth', authRoutes);
  app.use(errorHandler);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const { port } = server.address();
    const post = (path, body) =>
      fetch(`http://127.0.0.1:${port}/auth/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    const forgot = await post('forgot-password', {});
    assert.equal(forgot.status, 400);

    const reset = await post('reset-password', { token: 'token-de-prueba' });
    assert.equal(reset.status, 400);
    assert.deepEqual(await reset.json(), { error: MISSING_DATA_MESSAGE });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('PR-B11 (ruta): /auth/reset-password/check es pública y sin token responde 400 con { error } sin consultar la base', async (t) => {
  t.mock.method(console, 'error', () => {});
  const express = require('express');
  const { errorHandler } = require('@vuelos/shared');
  const authRoutes = require('../src/adapters/inbound/http/routes/auth.routes');
  const app = express();
  app.use(express.json());
  app.use('/auth', authRoutes);
  app.use(errorHandler);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const { port } = server.address();
    const check = await fetch(`http://127.0.0.1:${port}/auth/reset-password/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.equal(check.status, 400);
    assert.deepEqual(await check.json(), { error: INVALID_LINK_MESSAGE });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
