const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const createActivateUser = require('../src/application/use-cases/activateUser');
const {
  createCheckActivationTokenController,
} = require('../src/adapters/inbound/http/controllers/auth.controller');

const INVALID_TOKEN_MESSAGE = 'El token de activación no es válido o ya venció.';

const HOUR = 60 * 60 * 1000;
const START = new Date('2026-11-19T12:00:00Z').getTime();

// Token y contraseña de prueba: texto legible, sin aspecto de secreto.
const TOKEN = 'token-de-prueba';
const VALID = 'a'.repeat(12);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

const PENDING_USER = {
  id: '7a2b3c4d-5e6f-4a70-8b8c-9d0e1f2a3b4c',
  name: 'Luis Gómez',
  email: 'luis@aircrew.test',
  role: 'crew',
  is_active: false,
  password_hash: 'hash-provisional',
  activation_token_hash: sha256(TOKEN),
  activation_expires_at: new Date(START + 24 * HOUR),
};

// Repositorio en memoria con las mismas condiciones del UPDATE de activateUser:
// hash, activation_expires_at posterior a ahora e is_active = false.
function createFakeRepository({ users = [PENDING_USER], clock }) {
  const state = { users: users.map((user) => ({ ...user })) };
  const calls = [];

  function findPending(tokenHash) {
    return state.users.find(
      (user) =>
        user.activation_token_hash === tokenHash &&
        user.activation_expires_at > clock.now() &&
        user.is_active === false
    );
  }

  return {
    state,
    calls,
    async findPendingActivationByToken(tokenHash) {
      calls.push('findPendingActivationByToken');
      const user = findPending(tokenHash);
      return user ? { id: user.id } : null;
    },
    async activateUser({ activationTokenHash, passwordHash }) {
      calls.push('activateUser');
      const user = findPending(activationTokenHash);
      if (!user) return null;
      user.password_hash = passwordHash;
      user.is_active = true;
      user.activation_token_hash = null;
      user.activation_expires_at = null;
      return { id: user.id, name: user.name, email: user.email, role: user.role };
    },
  };
}

// Hasher falso: evita bcrypt en los tests.
const passwordHasher = { hash: async (value) => `hash:${value}` };

// El require va aquí para que, si el módulo falta, cada test falle por su cuenta.
function setup({ users } = {}) {
  const clock = { time: START };
  clock.now = () => new Date(clock.time);
  const userRepository = createFakeRepository({ users, clock });
  const createCheckActivationToken = require('../src/application/use-cases/checkActivationToken');

  return {
    clock,
    userRepository,
    checkActivationToken: createCheckActivationToken({ userRepository }),
    activateUser: createActivateUser({ userRepository, passwordHasher }),
  };
}

function savedUser(context) {
  return context.userRepository.state.users.find(
    (user) => user.id === PENDING_USER.id
  );
}

function rejectsWith(status, message) {
  return (error) => {
    assert.equal(error.status, status);
    assert.equal(error.message, message);
    return true;
  };
}

// --- Caso de uso ---

test('AC-B1: con un token válido de una cuenta pendiente responde { valid: true } sin modificar nada', async () => {
  const context = setup();
  const before = { ...savedUser(context) };

  const result = await context.checkActivationToken({ token: TOKEN });

  assert.deepEqual(result, { valid: true });
  assert.deepEqual(savedUser(context), before);
  assert.deepEqual(context.userRepository.calls, ['findPendingActivationByToken']);
});

test('AC-B1: después de la comprobación, el mismo token sigue sirviendo para activar la cuenta', async () => {
  const context = setup();

  await context.checkActivationToken({ token: TOKEN });
  const user = await context.activateUser({ token: TOKEN, password: VALID });

  assert.equal(user.id, PENDING_USER.id);
  assert.equal(savedUser(context).is_active, true);
  assert.equal(savedUser(context).password_hash, `hash:${VALID}`);
});

test('AC-B2: un token inexistente responde 400 con el mensaje del contrato', async () => {
  const context = setup();

  await assert.rejects(
    context.checkActivationToken({ token: 'otro-token-de-prueba' }),
    rejectsWith(400, INVALID_TOKEN_MESSAGE)
  );
});

test('AC-B2: un token vencido responde 400 con el mensaje del contrato', async () => {
  const context = setup();
  context.clock.time += 24 * HOUR + 1000;

  await assert.rejects(
    context.checkActivationToken({ token: TOKEN }),
    rejectsWith(400, INVALID_TOKEN_MESSAGE)
  );
});

test('AC-B2: un token ya usado para activar la cuenta responde 400', async () => {
  const context = setup();
  await context.activateUser({ token: TOKEN, password: VALID });

  await assert.rejects(
    context.checkActivationToken({ token: TOKEN }),
    rejectsWith(400, INVALID_TOKEN_MESSAGE)
  );
});

test('AC-B2: un token de una cuenta que ya está activa responde 400', async () => {
  const context = setup({ users: [{ ...PENDING_USER, is_active: true }] });

  await assert.rejects(
    context.checkActivationToken({ token: TOKEN }),
    rejectsWith(400, INVALID_TOKEN_MESSAGE)
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
  test(`AC-B2: ${label} responde 400 con el mensaje del contrato sin consultar el repositorio`, async () => {
    const context = setup();

    await assert.rejects(
      context.checkActivationToken(input),
      rejectsWith(400, INVALID_TOKEN_MESSAGE)
    );
    assert.deepEqual(context.userRepository.calls, []);
  });
}

// --- Controlador y HTTP ---

// Respuesta falsa de Express: guarda el estado y el body.
function createFakeRes() {
  const res = {
    statusCode: undefined,
    body: undefined,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(body) {
      res.body = body;
      return res;
    },
  };
  return res;
}

test('AC-B1 (controlador): activate/check responde 200 con { valid: true }', async () => {
  const handler = createCheckActivationTokenController(async () => ({ valid: true }));
  const res = createFakeRes();
  const errors = [];

  await handler({ body: { token: TOKEN } }, res, (error) => errors.push(error));

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { valid: true });
  assert.deepEqual(errors, []);
});

// Pasa la comprobación por el controlador y, si falla, por el errorHandler real de shared.
async function checkResponse(checkActivationToken, body) {
  const { errorHandler } = require('@vuelos/shared');
  const handler = createCheckActivationTokenController(checkActivationToken);
  const res = createFakeRes();
  let failure;

  await handler({ body }, res, (error) => {
    failure = error;
  });
  if (failure) errorHandler(failure, {}, res, () => {});

  return res;
}

test('AC-B1 (HTTP): un token válido responde 200 con { valid: true }', async () => {
  const context = setup();

  const res = await checkResponse(context.checkActivationToken, { token: TOKEN });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { valid: true });
});

test('AC-B2 (HTTP): un token vencido responde 400 con { error } y el mensaje exacto', async (t) => {
  t.mock.method(console, 'error', () => {});
  const context = setup();
  context.clock.time += 24 * HOUR + 1000;

  const res = await checkResponse(context.checkActivationToken, { token: TOKEN });

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: INVALID_TOKEN_MESSAGE });
});

test('AC-B2 (HTTP): sin token responde 400 con { error } y el mensaje exacto', async (t) => {
  t.mock.method(console, 'error', () => {});
  const context = setup();

  const res = await checkResponse(context.checkActivationToken, {});

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: INVALID_TOKEN_MESSAGE });
});

// --- Ruta ---

test('AC-B2 (ruta): /auth/activate/check es pública y sin token responde 400 con { error } sin consultar la base', async (t) => {
  t.mock.method(console, 'error', () => {});
  // El Pool de pg no se conecta hasta la primera consulta, y sin token
  // responde 400 antes de consultar.
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
    const check = await fetch(`http://127.0.0.1:${port}/auth/activate/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.equal(check.status, 400);
    assert.deepEqual(await check.json(), { error: INVALID_TOKEN_MESSAGE });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
