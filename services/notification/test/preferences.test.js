const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const jwt = require('jsonwebtoken');

// BE-6 (D6, docs/specs/cierre-pendientes.md, frontend): notification respeta las
// preferencias de notificaciones que la persona guarda en admin (GET /users/me).

// Antes de cargar los módulos: dotenv no pisa una variable que ya existe.
process.env.JWT_SECRET = 'secreto-de-prueba';

const { disabledAlertTypes } = require('../src/domain/alerts');
const { createPreferencesLoader } = require('../src/adapters/outbound/clients/adminClient');
const ssePublisher = require('../src/adapters/outbound/publishers/ssePublisher');
const createManageMyNotifications = require('../src/application/use-cases/manageMyNotifications');
const createStreamController = require('../src/adapters/inbound/http/controllers/stream.controller');

const USER_ID = '11111111-1111-4111-8111-111111111111';

function fakeResponse() {
  const res = { chunks: [], write: (chunk) => res.chunks.push(chunk) };
  return res;
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// ---------------------------------------------------------------- dominio

test('cada preferencia apaga su tipo de alerta; solo cuenta un false explícito', () => {
  assert.deepEqual(disabledAlertTypes({ absence_reported: false, absence_covered: true }), ['absence:reported']);
  assert.deepEqual(disabledAlertTypes({ absence_covered: false }), ['absence:covered']);
  assert.deepEqual(disabledAlertTypes({ replacement_assigned: false }), ['assignment:replacement']);
  assert.deepEqual(disabledAlertTypes({ absence_reported: null, absence_covered: undefined }), []);
  // El super_admin (o un perfil sin preferencias) trae notifications null.
  assert.deepEqual(disabledAlertTypes(null), []);
  assert.deepEqual(disabledAlertTypes(undefined), []);
});

// --------------------------------------------------- lectura de admin

test('lee las preferencias de admin con el token de la persona', async () => {
  const calls = [];
  const load = createPreferencesLoader({
    baseUrl: 'http://admin.test',
    fetchImpl: async (url, options) => {
      calls.push([url, options]);
      return jsonResponse(200, { id: USER_ID, notifications: { absence_reported: false, absence_covered: true } });
    },
  });

  assert.deepEqual(await load({ id: USER_ID, role: 'supervisor' }, 'tok-1'), ['absence:reported']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'http://admin.test/users/me');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer tok-1');
  assert.ok(calls[0][1].signal, 'la llamada lleva un timeout');
});

test('las preferencias se guardan 60 s por sesión (token)', async () => {
  const clock = { time: 1_000_000 };
  const calls = [];
  let reported = false;
  const load = createPreferencesLoader({
    baseUrl: 'http://admin.test',
    now: () => clock.time,
    fetchImpl: async (url, options) => {
      calls.push(options.headers.Authorization);
      return jsonResponse(200, { notifications: { absence_reported: reported } });
    },
  });
  const user = { id: USER_ID, role: 'supervisor' };
  const other = { id: '22222222-2222-4222-8222-222222222222', role: 'supervisor' };

  assert.deepEqual(await load(user, 'a'), ['absence:reported']);
  reported = true;
  clock.time += 59_000;
  assert.deepEqual(await load(user, 'a'), ['absence:reported'], 'dentro de los 60 s sale de la caché');
  assert.deepEqual(await load(other, 'b'), [], 'otra persona tiene su propia entrada');
  clock.time += 1_000;
  assert.deepEqual(await load(user, 'a'), [], 'a los 60 s se vuelve a preguntar');
  assert.deepEqual(calls, ['Bearer a', 'Bearer b', 'Bearer a']);
});

test('si admin falla, responde distinto de 200 o tarda, no se filtra nada y queda en el log', async (t) => {
  const errors = [];
  t.mock.method(console, 'error', (message) => errors.push(message));
  const user = { id: USER_ID, role: 'supervisor' };

  const down = createPreferencesLoader({
    baseUrl: 'http://admin.test',
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED');
    },
  });
  assert.deepEqual(await down(user, 'tok'), []);

  const revoked = createPreferencesLoader({
    baseUrl: 'http://admin.test',
    fetchImpl: async () => jsonResponse(401, { error: 'La sesión ya no es válida.' }),
  });
  assert.deepEqual(await revoked(user, 'tok'), []);

  const slow = createPreferencesLoader({
    baseUrl: 'http://admin.test',
    timeoutMs: 20,
    fetchImpl: (url, { signal }) =>
      new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
  });
  assert.deepEqual(await slow(user, 'tok'), []);

  assert.equal(errors.length, 3);
  assert.match(errors[0], /ECONNREFUSED/);
  assert.match(errors[1], /401/);
});

test('un fallo de admin no se guarda en la caché: la siguiente vez se pregunta de nuevo', async (t) => {
  t.mock.method(console, 'error', () => {});
  let fail = true;
  const load = createPreferencesLoader({
    baseUrl: 'http://admin.test',
    fetchImpl: async () => {
      if (fail) throw new Error('caído');
      return jsonResponse(200, { notifications: { absence_covered: false } });
    },
  });
  const user = { id: USER_ID, role: 'supervisor' };

  assert.deepEqual(await load(user, 'tok'), []);
  fail = false;
  assert.deepEqual(await load(user, 'tok'), ['absence:covered']);
});

// ------------------------------------------------------- publicador SSE

test('SSE: una conexión no recibe los tipos que la persona apagó', () => {
  const muted = fakeResponse();
  const open = fakeResponse();
  const crewMuted = fakeResponse();
  const removers = [
    ssePublisher.addConnection({ id: 'sup-1', role: 'supervisor' }, muted, { disabledTypes: ['absence:reported'] }),
    ssePublisher.addConnection({ id: 'sup-2', role: 'supervisor' }, open, { disabledTypes: [] }),
    ssePublisher.addConnection({ id: USER_ID, role: 'crew' }, crewMuted, { disabledTypes: ['assignment:replacement'] }),
  ];

  try {
    assert.equal(ssePublisher.publishToSupervisors({ type: 'absence:reported', message: 'x' }), 1);
    assert.equal(ssePublisher.publishToSupervisors({ type: 'absence:covered', message: 'y' }), 2);
    assert.equal(ssePublisher.publishToUser(USER_ID, { type: 'assignment:replacement', message: 'z' }), 0);
    assert.equal(ssePublisher.publishToUser(USER_ID, { type: 'certification:verified', message: 'w' }), 1);

    assert.equal(muted.chunks.length, 1);
    assert.match(muted.chunks[0], /absence:covered/);
    assert.equal(open.chunks.length, 2);
    assert.equal(crewMuted.chunks.length, 1);
    assert.match(crewMuted.chunks[0], /certification:verified/);
  } finally {
    removers.forEach((remove) => remove());
  }
});

// ------------------------------------------------------------ campana

test('la campana excluye de la lista y del contador los tipos apagados', async () => {
  const calls = [];
  const manage = createManageMyNotifications({
    notificationRepository: {
      findVisible: async (viewer, options) => calls.push(['find', options]) && [],
      countUnread: async (viewer, options) => calls.push(['count', options]) && 0,
    },
    loadDisabledTypes: async (viewer, token) => {
      calls.push(['prefs', viewer.id, token]);
      return ['absence:reported'];
    },
  });

  await manage.listMine({ id: USER_ID, role: 'supervisor' }, { limit: '5', token: 'tok' });

  assert.deepEqual(calls[0], ['prefs', USER_ID, 'tok']);
  assert.deepEqual(calls.slice(1).sort(), [
    ['count', { excludeTypes: ['absence:reported'] }],
    ['find', { limit: 5, excludeTypes: ['absence:reported'] }],
  ]);
});

test('la asignación de reemplazo siempre queda en la campana aunque la persona la haya apagado', async () => {
  const calls = [];
  const manage = createManageMyNotifications({
    notificationRepository: {
      findVisible: async (viewer, options) => calls.push(['find', options]) && [],
      countUnread: async (viewer, options) => calls.push(['count', options]) && 0,
    },
    loadDisabledTypes: async () => ['assignment:replacement', 'absence:covered'],
  });

  await manage.listMine({ id: USER_ID, role: 'crew' }, { token: 'tok' });

  assert.deepEqual(calls.sort(), [
    ['count', { excludeTypes: ['absence:covered'] }],
    ['find', { limit: 20, excludeTypes: ['absence:covered'] }],
  ]);
});

test('la campana valida limit antes de preguntar a admin', async () => {
  let asked = false;
  const manage = createManageMyNotifications({
    notificationRepository: {},
    loadDisabledTypes: async () => {
      asked = true;
      return [];
    },
  });

  await assert.rejects(manage.listMine({ id: USER_ID, role: 'crew' }, { limit: '0', token: 'tok' }), (error) => error.status === 400);
  assert.equal(asked, false);
});

// ------------------------------------------------------- GET /stream

function fakeStreamRequest(headers) {
  const req = new EventEmitter();
  req.headers = headers;
  req.destroyed = false;
  return req;
}

function fakeStreamResponse() {
  const res = {
    statusCode: null,
    body: null,
    chunks: [],
    ended: false,
    status(code) {
      res.statusCode = code;
      return res;
    },
    set: () => res,
    json(body) {
      res.body = body;
      return res;
    },
    flushHeaders() {},
    write: (chunk) => res.chunks.push(chunk),
    end() {
      res.ended = true;
    },
  };
  return res;
}

function fakePublisher() {
  const connections = [];
  return {
    connections,
    addConnection(user, res, preferences) {
      const connection = { user, res, preferences, removed: false };
      connections.push(connection);
      return () => {
        connection.removed = true;
      };
    },
    events: [],
    writeEvent(res, type, data) {
      this.events.push({ type, data });
    },
  };
}

function tokenFor(role) {
  return jwt.sign({ role }, 'secreto-de-prueba', { subject: USER_ID, issuer: 'aircrew-admin', expiresIn: '1h' });
}

test('GET /stream: el super_admin recibe 403 sin preguntar a admin', async () => {
  let asked = false;
  const publisher = fakePublisher();
  const stream = createStreamController({
    publisher,
    loadDisabledTypes: async () => {
      asked = true;
      return [];
    },
  });
  const res = fakeStreamResponse();

  await stream(fakeStreamRequest({ authorization: `Bearer ${tokenFor('super_admin')}` }), res, assert.fail);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'El super_admin no recibe notificaciones.');
  assert.equal(res.body.code, 'forbidden');
  assert.equal(asked, false);
  assert.equal(publisher.connections.length, 0);
});

test('GET /stream: carga las preferencias con el token de la cookie y las guarda en la conexión', async () => {
  const asked = [];
  const publisher = fakePublisher();
  const stream = createStreamController({
    publisher,
    loadDisabledTypes: async (user, token) => {
      asked.push([user.id, token]);
      return ['absence:reported'];
    },
  });
  const token = tokenFor('supervisor');
  const req = fakeStreamRequest({ cookie: `aircrew_token=${token}` });

  await stream(req, fakeStreamResponse(), assert.fail);

  assert.deepEqual(asked, [[USER_ID, token]]);
  assert.equal(publisher.connections.length, 1);
  assert.deepEqual(publisher.connections[0].preferences.disabledTypes, ['absence:reported']);
  req.emit('close');
  assert.equal(publisher.connections[0].removed, true);
});

test('GET /stream: con la conexión abierta, las preferencias se vuelven a leer cada cierto tiempo', async () => {
  let types = ['absence:reported'];
  const publisher = fakePublisher();
  const stream = createStreamController({
    publisher,
    preferencesMs: 20,
    loadDisabledTypes: async () => types,
  });
  const req = fakeStreamRequest({ authorization: `Bearer ${tokenFor('supervisor')}` });

  await stream(req, fakeStreamResponse(), assert.fail);
  types = [];
  await new Promise((resolve) => setTimeout(resolve, 60));

  try {
    assert.deepEqual(publisher.connections[0].preferences.disabledTypes, []);
  } finally {
    req.emit('close');
  }
});

test('GET /stream: si la persona se va mientras se leen las preferencias, no queda conexión', async () => {
  const publisher = fakePublisher();
  const req = fakeStreamRequest({ authorization: `Bearer ${tokenFor('supervisor')}` });
  const res = fakeStreamResponse();
  const stream = createStreamController({
    publisher,
    loadDisabledTypes: async () => {
      req.destroyed = true;
      req.emit('close');
      return [];
    },
  });

  await stream(req, res, assert.fail);

  assert.equal(publisher.connections.length, 0);
  assert.equal(res.statusCode, null);
});

// --------------------------------------- revisión final: sesión anulada en el SSE

test('Revisión: un 401 de admin llama a onUnauthorized y no se guarda; sigue sin filtrar', async (t) => {
  t.mock.method(console, 'error', () => {});
  let unauthorized = 0;
  const load = createPreferencesLoader({
    baseUrl: 'http://admin.test',
    fetchImpl: async () => jsonResponse(401, { error: 'La sesión ya no es válida.', code: 'session_revoked' }),
  });
  const user = { id: USER_ID, role: 'supervisor' };

  assert.deepEqual(await load(user, 'tok', { onUnauthorized: () => (unauthorized += 1) }), []);
  assert.deepEqual(await load(user, 'tok'), [], 'sin onUnauthorized (la campana) no falla');
  assert.equal(unauthorized, 1);
});

test('Revisión: otro estado distinto de 200 no llama a onUnauthorized', async (t) => {
  t.mock.method(console, 'error', () => {});
  let unauthorized = 0;
  const load = createPreferencesLoader({
    baseUrl: 'http://admin.test',
    fetchImpl: async () => jsonResponse(503, {}),
  });

  await load({ id: USER_ID, role: 'supervisor' }, 'tok', { onUnauthorized: () => (unauthorized += 1) });

  assert.equal(unauthorized, 0);
});

test('Revisión: la caché es por token: la sesión nueva de la persona no tapa el 401 de la anulada', async (t) => {
  t.mock.method(console, 'error', () => {});
  const asked = [];
  const load = createPreferencesLoader({
    baseUrl: 'http://admin.test',
    fetchImpl: async (url, options) => {
      asked.push(options.headers.Authorization);
      return options.headers.Authorization === 'Bearer nuevo'
        ? jsonResponse(200, { notifications: {} })
        : jsonResponse(401, { error: 'La sesión ya no es válida.' });
    },
  });
  const user = { id: USER_ID, role: 'supervisor' };
  let unauthorized = 0;

  await load(user, 'nuevo');
  await load(user, 'anulado', { onUnauthorized: () => (unauthorized += 1) });

  assert.deepEqual(asked, ['Bearer nuevo', 'Bearer anulado']);
  assert.equal(unauthorized, 1);
});

test('Revisión: GET /stream: si al refrescar las preferencias admin responde 401, envía auth:expired y cierra', async () => {
  let calls = 0;
  const publisher = fakePublisher();
  const stream = createStreamController({
    publisher,
    preferencesMs: 20,
    loadDisabledTypes: async (user, token, options = {}) => {
      calls += 1;
      if (calls > 1 && options.onUnauthorized) options.onUnauthorized();
      return [];
    },
  });
  const req = fakeStreamRequest({ authorization: `Bearer ${tokenFor('supervisor')}` });
  const res = fakeStreamResponse();

  await stream(req, res, assert.fail);
  await new Promise((resolve) => setTimeout(resolve, 60));

  try {
    assert.equal(res.ended, true);
    const expired = publisher.events.filter(({ type }) => type === 'auth:expired');
    assert.equal(expired.length, 1, 'un solo aviso aunque haya más refrescos');
    assert.equal(expired[0].data.message, 'Tu sesión ya no es válida. Inicia sesión de nuevo.');
    assert.equal(publisher.connections[0].removed, true, 'deja de recibir avisos enseguida');
    const before = calls;
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(calls, before, 'no vuelve a preguntar a admin');
  } finally {
    req.emit('close');
  }
});

test('Revisión: la caché por token no crece sin límite: con 5000 entradas sale la más antigua', async () => {
  const asked = [];
  const load = createPreferencesLoader({
    baseUrl: 'http://admin.test',
    fetchImpl: async (url, options) => {
      asked.push(options.headers.Authorization);
      return jsonResponse(200, { notifications: {} });
    },
  });
  const user = { id: USER_ID, role: 'supervisor' };

  for (let index = 0; index < 5000; index += 1) await load(user, `t-${index}`);
  await load(user, 't-0');
  assert.equal(asked.length, 5000, 'con 5000 siguen todas');
  await load(user, 't-5000');
  await load(user, 't-1');
  assert.equal(asked.length, 5001, 't-1 sigue en caché');
  await load(user, 't-0');
  assert.equal(asked.length, 5002, 't-0, la más antigua, salió');
});
