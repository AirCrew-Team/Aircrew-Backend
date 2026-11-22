const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// D4: cambiar la contraseña cierra las demás sesiones.
// Antes de cargar la app: dotenv no pisa una variable que ya existe, y `secure`
// de la cookie depende de NODE_ENV (fuera de producción es false).
const signingKey = 'prueba'.repeat(4);
process.env.JWT_SECRET = signingKey;
delete process.env.NODE_ENV;
const app = require('../src/app');
const pool = require('../src/adapters/outbound/persistence/pool');
const { jwtExpiresIn } = require('../src/config/env');

const USER_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const SESSION_MESSAGE = 'La sesión ya no es válida.';

// Contraseñas de prueba: texto repetido, sin aspecto de secreto.
const CURRENT = 'a'.repeat(12);
const NEXT = 'b'.repeat(12);

// Duración del token que firma el admin, en segundos.
const LIFETIME = (() => {
  const { iat, exp } = jwt.decode(jwt.sign({}, 'x', { expiresIn: jwtExpiresIn }));
  return exp - iat;
})();

// Segundo de referencia: hace 10 minutos, así los tokens de prueba no han vencido.
const T = Math.floor(Date.now() / 1000) - 600;

// Token del admin con un iat fijo (en segundos).
function tokenAt(iat, { role = 'crew', subject = USER_ID } = {}) {
  return jwt.sign({ role, iat }, signingKey, {
    subject,
    issuer: 'aircrew-admin',
    expiresIn: '1h',
  });
}

// Fila de findById (/auth/me).
const USER_ROW = {
  id: USER_ID,
  name: 'Ana Pérez',
  email: 'ana@aircrew.test',
  role: 'crew',
  is_active: true,
  created_at: new Date('2026-01-10T15:00:00Z'),
  pending_activation: false,
};

// Fila de findProfileById (/users/me*).
const PROFILE_ROW = {
  ...USER_ROW,
  phone: null,
  residence: null,
  photo_updated_at: null,
  notify_absence_reported: true,
  notify_absence_covered: true,
  notify_replacement_assigned: false,
};
delete PROFILE_ROW.pending_activation;

// Solo responde las lecturas de la cuenta. Cualquier escritura u otra consulta
// falla el test: con un token viejo no se debe tocar nada.
function accountReads(changedAt) {
  return async (sql) => {
    if (/FROM public\.users u/.test(sql)) {
      return { rows: [{ ...PROFILE_ROW, password_changed_at: changedAt }] };
    }
    if (/SELECT password_hash, is_active/.test(sql)) {
      return {
        rows: [
          {
            password_hash: bcrypt.hashSync(CURRENT, 4),
            is_active: true,
            role: 'crew',
            password_changed_at: changedAt,
          },
        ],
      };
    }
    if (/FROM public\.users\s+WHERE id = \$1/.test(sql)) {
      return { rows: [{ ...USER_ROW, password_changed_at: changedAt }] };
    }
    throw new Error(`Consulta inesperada en el test: ${sql}`);
  };
}

// Ninguna consulta llega a PostgreSQL: responde `query` (pool) y `client` (transacción).
function useDatabase(t, query, client) {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql, params });
    return query(sql, params);
  });
  t.mock.method(pool, 'connect', async () => {
    if (!client) throw new Error('Conexión inesperada en el test.');
    calls.push({ sql: 'connect' });
    return {
      async query(sql, params) {
        calls.push({ sql, params });
        return client(sql, params);
      },
      release() {},
    };
  });
  return calls;
}

async function request(path, { method = 'GET', token, body } = {}) {
  const server = app.listen(0);
  await once(server, 'listening');
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers,
      body,
    });
    const text = await response.text();
    const isJson = (response.headers.get('content-type') || '').includes('application/json');
    return {
      status: response.status,
      headers: response.headers,
      body: isJson ? JSON.parse(text) : null,
    };
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

const isWrite = ({ sql }) => /UPDATE|INSERT|DELETE|connect/.test(sql);

// --- D4-B1: /auth/me y /users/me ---

for (const path of ['/auth/me', '/users/me']) {
  test(`D4-B1 (HTTP): GET ${path} con un token anterior al cambio de contraseña responde 401`, async (t) => {
    t.mock.method(console, 'error', () => {});
    useDatabase(t, accountReads(new Date((T + 1) * 1000)));

    const res = await request(path, { token: tokenAt(T) });

    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: SESSION_MESSAGE });
  });

  test(`D4-B1 (HTTP): GET ${path} con un token del mismo segundo que el cambio responde 200`, async (t) => {
    // El iat no tiene milisegundos: el cambio a las T,999 s no invalida un token de T.
    useDatabase(t, accountReads(new Date(T * 1000 + 999)));

    const res = await request(path, { token: tokenAt(T) });

    assert.equal(res.status, 200);
    assert.equal(res.body.id, USER_ID);
  });

  test(`D4-B1 (HTTP): GET ${path} de una cuenta sin password_changed_at no compara fechas`, async (t) => {
    useDatabase(t, accountReads(null));

    const res = await request(path, { token: tokenAt(T) });

    assert.equal(res.status, 200);
  });
}

test('D4-B1 (HTTP): GET /auth/me responde la misma cuenta de siempre, sin password_changed_at', async (t) => {
  useDatabase(t, accountReads(new Date(T * 1000)));

  const res = await request('/auth/me', { token: tokenAt(T) });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    ...USER_ROW,
    created_at: USER_ROW.created_at.toISOString(),
  });
});

test('D4 (HTTP): GET /users/:id de la propia cuenta no expone password_changed_at', async (t) => {
  useDatabase(t, accountReads(new Date(T * 1000)));

  const res = await request(`/users/${USER_ID}`, { token: tokenAt(T) });

  assert.equal(res.status, 200);
  assert.ok(!('password_changed_at' in res.body));
});

test('D4 (HTTP): un token sin iat responde 401 sin consultar la base', async (t) => {
  const calls = useDatabase(t, accountReads(null));
  const token = jwt.sign({ role: 'crew' }, signingKey, {
    subject: USER_ID,
    issuer: 'aircrew-admin',
    expiresIn: '1h',
    noTimestamp: true,
  });

  const res = await request('/auth/me', { token });

  assert.equal(res.status, 401);
  assert.deepEqual(res.body, { error: 'El token de autenticación no es válido.', code: 'invalid_token' });
  assert.deepEqual(calls, []);
});

// --- D4-B1: las demás rutas /users/me* no tocan nada con un token viejo ---

for (const [label, method, path, body] of [
  ['PATCH /users/me', 'PATCH', '/users/me', JSON.stringify({ residence: 'Boston, MA' })],
  [
    'PUT /users/me/photo',
    'PUT',
    '/users/me/photo',
    JSON.stringify({
      mime_type: 'image/png',
      data_base64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64'),
    }),
  ],
  ['GET /users/me/photo', 'GET', '/users/me/photo'],
  ['DELETE /users/me/photo', 'DELETE', '/users/me/photo'],
]) {
  test(`D4-B1 (HTTP): ${label} con un token anterior al cambio responde 401 sin escribir`, async (t) => {
    t.mock.method(console, 'error', () => {});
    const calls = useDatabase(t, accountReads(new Date((T + 1) * 1000)));

    const res = await request(path, { method, token: tokenAt(T), body });

    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: SESSION_MESSAGE });
    assert.ok(!calls.some(isWrite), 'no debe escribir con un token viejo');
    assert.ok(!calls.some(({ sql }) => /FROM public\.user_photos/.test(sql)));
  });
}

// --- POST /auth/change-password ---

test('D4-B1 (HTTP): POST /auth/change-password con un token anterior al cambio responde 401 sin abrir la transacción', async (t) => {
  t.mock.method(console, 'error', () => {});
  const calls = useDatabase(t, accountReads(new Date((T + 1) * 1000)));

  const res = await request('/auth/change-password', {
    method: 'POST',
    token: tokenAt(T),
    body: JSON.stringify({ current_password: CURRENT, new_password: NEXT }),
  });

  assert.equal(res.status, 401);
  assert.deepEqual(res.body, { error: SESSION_MESSAGE });
  assert.equal(res.headers.get('set-cookie'), null);
  assert.ok(!calls.some(isWrite));
});

// Transacción del cambio: bloqueo, relectura, conteo, UPDATE y evento.
function changeTransaction(savedAt, row) {
  return async (sql) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim())) return { rows: [] };
    if (/FOR UPDATE/.test(sql)) return { rows: [{ id: USER_ID }] };
    if (/SELECT password_hash, is_active/.test(sql)) return { rows: [row] };
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ count: 0 }] };
    if (/UPDATE public\.users/.test(sql)) return { rows: [{ password_changed_at: savedAt }] };
    if (/INSERT INTO public\.password_reset_events/.test(sql)) return { rows: [] };
    throw new Error(`Consulta inesperada en el test: ${sql}`);
  };
}

test('D4-B2 (HTTP): un cambio correcto responde 200 { password_changed_at } con una cookie de sesión nueva, como el login', async (t) => {
  const previous = new Date((T - 60) * 1000);
  const row = {
    password_hash: bcrypt.hashSync(CURRENT, 4),
    is_active: true,
    role: 'crew',
    password_changed_at: previous,
  };
  const savedAt = new Date();
  useDatabase(t, async () => ({ rows: [row] }), changeTransaction(savedAt, row));

  const res = await request('/auth/change-password', {
    method: 'POST',
    token: tokenAt(T),
    body: JSON.stringify({ current_password: CURRENT, new_password: NEXT }),
  });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { password_changed_at: savedAt.toISOString() });

  const setCookie = res.headers.get('set-cookie') || '';
  const match = /^aircrew_token=([^;]+);/.exec(setCookie);
  assert.ok(match, `se esperaba la cookie aircrew_token, llegó: ${setCookie}`);
  assert.match(setCookie, /; Path=\//);
  assert.match(setCookie, /; HttpOnly/);
  assert.match(setCookie, /; SameSite=Lax/);
  assert.doesNotMatch(setCookie, /Secure/);
  const maxAge = Number(/Max-Age=(\d+)/.exec(setCookie)[1]);
  assert.ok(Math.abs(maxAge - LIFETIME) <= 5, `Max-Age esperado ≈ ${LIFETIME}, llegó ${maxAge}`);

  const payload = jwt.verify(match[1], signingKey, { issuer: 'aircrew-admin' });
  assert.equal(payload.sub, USER_ID);
  assert.ok(payload.iat >= Math.floor(savedAt.getTime() / 1000));
});

test('D4-B2 (HTTP): con el token de la cookie nueva /auth/me responde 200 y con el anterior 401', async (t) => {
  t.mock.method(console, 'error', () => {});
  const row = {
    password_hash: bcrypt.hashSync(CURRENT, 4),
    is_active: true,
    role: 'crew',
    password_changed_at: null,
  };
  const savedAt = new Date();
  const oldToken = tokenAt(T);
  useDatabase(t, async () => ({ rows: [row] }), changeTransaction(savedAt, row));

  const change = await request('/auth/change-password', {
    method: 'POST',
    token: oldToken,
    body: JSON.stringify({ current_password: CURRENT, new_password: NEXT }),
  });
  const newToken = /^aircrew_token=([^;]+);/.exec(change.headers.get('set-cookie') || '')[1];

  // Desde aquí la cuenta ya tiene la fecha del cambio.
  t.mock.restoreAll();
  t.mock.method(console, 'error', () => {});
  useDatabase(t, accountReads(savedAt));

  assert.equal((await request('/auth/me', { token: newToken })).status, 200);
  const stale = await request('/auth/me', { token: oldToken });
  assert.equal(stale.status, 401);
  assert.deepEqual(stale.body, { error: SESSION_MESSAGE });
});

// --- Caso de uso changePassword ---

// Repositorio falso mínimo: el bloqueo solo ejecuta fn.
function createChangeRepository({ row, savedAt }) {
  const calls = [];
  const locked = {
    async findPasswordHash() {
      calls.push('findPasswordHash');
      return { ...row };
    },
    async countPasswordResetEvents() {
      calls.push('countPasswordResetEvents');
      return 0;
    },
    async savePasswordChange() {
      calls.push('savePasswordChange');
      return savedAt;
    },
  };
  return {
    calls,
    findPasswordHash: locked.findPasswordHash,
    async withPasswordResetLock(userId, fn) {
      calls.push('withPasswordResetLock');
      return fn(locked);
    },
  };
}

function setupChange({ row: rowOverrides = {}, savedAt = new Date(T * 1000), now = savedAt } = {}) {
  const createChangePassword = require('../src/application/use-cases/changePassword');
  const row = {
    password_hash: `hash:${CURRENT}`,
    is_active: true,
    role: 'crew',
    password_changed_at: null,
    ...rowOverrides,
  };
  const userRepository = createChangeRepository({ row, savedAt });
  const passwordHasher = {
    async hash(value) {
      userRepository.calls.push('hash');
      return `hash:${value}`;
    },
    async compare(value, hash) {
      userRepository.calls.push('compare');
      return hash === `hash:${value}`;
    },
  };
  return {
    userRepository,
    changePassword: createChangePassword({ userRepository, passwordHasher, now: () => now }),
  };
}

const input = { current_password: CURRENT, new_password: NEXT };

function rejectsWith(status, message) {
  return (error) => {
    assert.equal(error.status, status);
    assert.equal(error.message, message);
    return true;
  };
}

test('D4: changePassword con un token anterior al último cambio responde 401 sin comparar ni bloquear', async () => {
  const { changePassword, userRepository } = setupChange({
    row: { password_changed_at: new Date((T + 1) * 1000) },
  });

  await assert.rejects(
    changePassword({ id: USER_ID, role: 'crew', iat: T }, input),
    rejectsWith(401, SESSION_MESSAGE)
  );
  assert.deepEqual(userRepository.calls, ['findPasswordHash']);
});

test('D4: changePassword con un token del mismo segundo que el último cambio sigue adelante', async () => {
  const { changePassword } = setupChange({
    row: { password_changed_at: new Date(T * 1000 + 999) },
    savedAt: new Date((T + 5) * 1000),
  });

  const result = await changePassword({ id: USER_ID, role: 'crew', iat: T }, input);

  assert.deepEqual(result.password_changed_at, new Date((T + 5) * 1000));
});

test('D4: el token nuevo lleva la cuenta, el rol guardado, el emisor y la duración del login', async () => {
  const { changePassword } = setupChange({ row: { role: 'supervisor' } });

  const { token } = await changePassword({ id: USER_ID, role: 'crew', iat: T }, input);

  const payload = jwt.verify(token, signingKey, { issuer: 'aircrew-admin', ignoreExpiration: true });
  assert.equal(payload.sub, USER_ID);
  assert.equal(payload.role, 'supervisor');
  assert.equal(payload.exp - payload.iat, LIFETIME);
});

test('D4: el token nuevo tiene el iat del segundo del cambio aunque el reloj del servicio vaya atrás', async () => {
  // La fecha la pone PostgreSQL (NOW()); el servicio puede ir 2 s por detrás.
  const savedAt = new Date(T * 1000 + 999);
  const { changePassword } = setupChange({ savedAt, now: new Date(savedAt.getTime() - 2000) });

  const { token } = await changePassword({ id: USER_ID, role: 'crew', iat: T - 60 }, input);

  assert.equal(jwt.decode(token).iat, T);
});

test('D4: el token nuevo usa la hora del servicio si va por delante de la fecha guardada', async () => {
  const savedAt = new Date(T * 1000 + 999);
  const { changePassword } = setupChange({ savedAt, now: new Date((T + 3) * 1000 + 500) });

  const { token } = await changePassword({ id: USER_ID, role: 'crew', iat: T - 60 }, input);

  assert.equal(jwt.decode(token).iat, T + 3);
});

// --- Login: la firma compartida no cambia su token ---

test('D4: el login sigue firmando el token con sub, role, iss y la duración configurada', async () => {
  const createLogin = require('../src/application/use-cases/login');
  const login = createLogin({
    userRepository: {
      async findByEmail() {
        return {
          ...USER_ROW,
          role: 'supervisor',
          password_hash: `hash:${CURRENT}`,
        };
      },
    },
    passwordHasher: { compare: async (value, hash) => hash === `hash:${value}` },
  });
  const before = Math.floor(Date.now() / 1000);

  const { token } = await login({ email: 'ana@aircrew.test', password: CURRENT });

  const payload = jwt.verify(token, signingKey, { issuer: 'aircrew-admin' });
  assert.deepEqual(Object.keys(payload).sort(), ['exp', 'iat', 'iss', 'role', 'sub']);
  assert.equal(payload.sub, USER_ID);
  assert.equal(payload.role, 'supervisor');
  assert.equal(payload.exp - payload.iat, LIFETIME);
  assert.ok(payload.iat >= before && payload.iat <= Math.floor(Date.now() / 1000));
});

// --- Dominio: la regla de la sesión vigente ---

test('D4: isCurrentSession compara el iat con password_changed_at redondeado hacia abajo al segundo', () => {
  const { isCurrentSession } = require('../src/domain/entities/user');
  const account = (changedAt, isActive = true) => ({
    is_active: isActive,
    password_changed_at: changedAt,
  });

  assert.equal(isCurrentSession(account(null), { iat: T }), true);
  assert.equal(isCurrentSession(account(new Date(T * 1000 + 999)), { iat: T }), true);
  assert.equal(isCurrentSession(account(new Date((T + 1) * 1000)), { iat: T }), false);
  assert.equal(isCurrentSession(account(new Date((T - 1) * 1000)), { iat: T }), true);
  assert.equal(isCurrentSession(account(null, false), { iat: T }), false);
  assert.equal(isCurrentSession(null, { iat: T }), false);
});
