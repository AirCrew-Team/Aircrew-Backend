const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const jwt = require('jsonwebtoken');

// Eliminar usuarios (docs/specs/eliminar-usuarios.md, frontend). DELETE
// /users/:id/permanent borra la cuenta de forma definitiva. Admin lo orquesta en
// orden: flights (libera los puestos), notification (avisa a los supervisores y borra
// sus avisos), recommendation (sus sugerencias), crew (perfil, certificaciones y
// ausencias) y por último la cuenta. Si un servicio falla, 502 y la cuenta sigue.

// Antes de cargar src: config/env fija las variables con el primer require. Los
// servicios apuntan a un servidor falso de este archivo (puerto dinámico: before()).
const signingKey = 'prueba'.repeat(4);
process.env.JWT_SECRET = signingKey;
process.env.ADMIN_SERVICE_KEY = 'clave-de-admin';

let fakeServer;
let fakeUrl;
let fakeRoutes = {};
const seen = [];
let app;
let pool;
let createDeleteUser;
let internalClients;
let crewClient;
let userRepository;

before(async () => {
  fakeServer = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers });
    const handler = fakeRoutes[`${req.method} ${req.url}`];
    if (!handler) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Ruta no encontrada.' }));
    }
    const [status, body] = handler();
    res.writeHead(status, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(body));
  });
  fakeServer.listen(0, '127.0.0.1');
  await once(fakeServer, 'listening');
  fakeUrl = `http://127.0.0.1:${fakeServer.address().port}`;
  for (const name of ['CREW', 'FLIGHTS', 'RECOMMENDATION', 'NOTIFICATION']) {
    process.env[`${name}_SERVICE_URL`] = fakeUrl;
  }

  app = require('../src/app');
  pool = require('../src/adapters/outbound/persistence/pool');
  createDeleteUser = require('../src/application/use-cases/deleteUser');
  internalClients = require('../src/adapters/outbound/clients/internalClients');
  crewClient = require('../src/adapters/outbound/clients/crewClient');
  userRepository = require('../src/adapters/outbound/persistence/repositories/userRepository');
});

after(async () => {
  fakeServer.closeAllConnections();
  await new Promise((resolve) => fakeServer.close(resolve));
});

const ADMIN_ID = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const OTHER_ADMIN_ID = '2b3c4d5e-6f70-4a1b-8c2d-3e4f5a6b7c8d';
const CREW_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const SUPERVISOR_ID = '7a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const FLIGHT_ID = '11111111-1111-4111-8111-111111111111';
const REQUESTER = { id: ADMIN_ID, role: 'super_admin' };

const VACATED = {
  flight_id: FLIGHT_ID,
  flight_number: 'DL1102',
  origin: 'JFK',
  destination: 'LAX',
  departure_at: '2026-12-01T15:00:00.000Z',
  slot_id: 'fa-1',
  role: 'flight_attendant',
};

function account(id, overrides = {}) {
  return {
    id,
    name: 'Diego Salcedo',
    email: 'd.salcedo@aircrew.test',
    role: 'crew',
    is_active: true,
    pending_activation: false,
    ...overrides,
  };
}

// Repositorio y clientes falsos: `steps` guarda el orden de las llamadas.
function setup({ users = [account(CREW_ID)], otherAdmins = 1, vacated = [VACATED], fail = {} } = {}) {
  const steps = [];
  const stored = new Map(users.map((user) => [user.id, user]));
  const maybeFail = (name) => {
    if (fail[name]) {
      fail[name] -= 1;
      throw Object.assign(new Error(`${name} no responde`), { status: 502 });
    }
  };

  const userRepository = {
    async findById(id) {
      return stored.get(id) || null;
    },
    async countActiveSuperAdminsExcept(id) {
      steps.push(['countSuperAdmins', id]);
      return otherAdmins;
    },
    async deleteUser(id) {
      steps.push(['admin.deleteUser', id]);
      maybeFail('admin');
      stored.delete(id);
      return 'deleted';
    },
  };
  const flightsClient = {
    async releaseAssignments(id) {
      steps.push(['flights.releaseAssignments', id]);
      maybeFail('flights');
      const result = { deleted: vacated.length, restored: 0, vacated_flights: vacated };
      vacated = [];
      return result;
    },
  };
  const notificationClient = {
    async publishSlotVacated(flight) {
      steps.push(['notification.publishSlotVacated', flight.flight_number]);
      maybeFail('alert');
    },
    async deleteNotifications(id) {
      steps.push(['notification.deleteNotifications', id]);
      maybeFail('notification');
      return { deleted: 0, reads_deleted: 0 };
    },
  };
  const recommendationClient = {
    async deleteSuggestions(id) {
      steps.push(['recommendation.deleteSuggestions', id]);
      maybeFail('recommendation');
      return { deleted: 0 };
    },
  };
  const crewClient = {
    async eraseUser(id) {
      steps.push(['crew.eraseUser', id]);
      maybeFail('crew');
      return { profile: 1 };
    },
  };

  const deleteUser = createDeleteUser({
    userRepository,
    crewClient,
    flightsClient,
    notificationClient,
    recommendationClient,
  });

  return { deleteUser, steps, stored };
}

function rejectsWith(status, code) {
  return (error) => {
    assert.equal(error.status, status);
    if (code) assert.equal(error.code, code);
    return true;
  };
}

// ------------------------------------------------------------- caso de uso

test('EU-01: eliminar un tripulante sigue el orden y avisa por cada vuelo futuro', async () => {
  const { deleteUser, steps, stored } = setup();

  const result = await deleteUser(REQUESTER, CREW_ID);

  assert.deepEqual(result, { id: CREW_ID, vacated_flights: [VACATED] });
  assert.deepEqual(steps, [
    ['flights.releaseAssignments', CREW_ID],
    ['notification.publishSlotVacated', 'DL1102'],
    ['notification.deleteNotifications', CREW_ID],
    ['recommendation.deleteSuggestions', CREW_ID],
    ['crew.eraseUser', CREW_ID],
    ['admin.deleteUser', CREW_ID],
  ]);
  assert.equal(stored.has(CREW_ID), false);
});

test('un usuario inexistente o un id inválido es 404 y no toca nada', async () => {
  const { deleteUser, steps } = setup();

  await assert.rejects(deleteUser(REQUESTER, SUPERVISOR_ID), rejectsWith(404));
  await assert.rejects(deleteUser(REQUESTER, 'no-es-uuid'), rejectsWith(404));
  assert.deepEqual(steps, []);
});

test('EU-05: un super_admin no puede eliminarse a sí mismo (409) y no se toca nada', async () => {
  const { deleteUser, steps } = setup({ users: [account(ADMIN_ID, { role: 'super_admin' })] });

  await assert.rejects(deleteUser(REQUESTER, ADMIN_ID), (error) => {
    assert.equal(error.status, 409);
    assert.equal(error.code, 'cannot_delete_self');
    assert.equal(error.message, 'No puedes eliminar tu propia cuenta.');
    return true;
  });
  assert.deepEqual(steps, []);
});

test('EU-05: no se puede eliminar al último super_admin activo (409)', async () => {
  const { deleteUser, steps } = setup({
    users: [account(OTHER_ADMIN_ID, { role: 'super_admin' })],
    otherAdmins: 0,
  });

  await assert.rejects(deleteUser(REQUESTER, OTHER_ADMIN_ID), (error) => {
    assert.equal(error.status, 409);
    assert.equal(error.code, 'last_super_admin');
    assert.equal(error.message, 'No se puede eliminar al último super_admin.');
    return true;
  });
  assert.deepEqual(steps, [['countSuperAdmins', OTHER_ADMIN_ID]]);
});

test('se puede eliminar a otro super_admin si queda alguno activo', async () => {
  const { deleteUser, stored } = setup({
    users: [account(OTHER_ADMIN_ID, { role: 'super_admin' })],
    vacated: [],
  });

  await deleteUser(REQUESTER, OTHER_ADMIN_ID);

  assert.equal(stored.has(OTHER_ADMIN_ID), false);
});

test('si la cuenta cambió entre la comprobación y el borrado (último super_admin), 409', async () => {
  const deleteRace = createDeleteUser({
    userRepository: {
      findById: async () => account(OTHER_ADMIN_ID, { role: 'super_admin' }),
      countActiveSuperAdminsExcept: async () => 1,
      deleteUser: async () => 'last_super_admin',
    },
    crewClient: { eraseUser: async () => ({}) },
    flightsClient: { releaseAssignments: async () => ({ vacated_flights: [] }) },
    notificationClient: { publishSlotVacated: async () => {}, deleteNotifications: async () => ({}) },
    recommendationClient: { deleteSuggestions: async () => ({}) },
  });

  await assert.rejects(deleteRace(REQUESTER, OTHER_ADMIN_ID), rejectsWith(409, 'last_super_admin'));
});

test('EU-04: una cuenta inactiva se puede eliminar', async () => {
  const { deleteUser, stored } = setup({ users: [account(CREW_ID, { is_active: false })] });

  await deleteUser(REQUESTER, CREW_ID);

  assert.equal(stored.has(CREW_ID), false);
});

test('EU-03: una cuenta con la invitación pendiente se puede eliminar', async () => {
  const { deleteUser, stored } = setup({
    users: [account(CREW_ID, { is_active: false, pending_activation: true })],
  });

  await deleteUser(REQUESTER, CREW_ID);

  assert.equal(stored.has(CREW_ID), false);
});

test('EU-08: eliminar un supervisor pasa por los mismos pasos (no tiene vuelos)', async () => {
  const { deleteUser, steps, stored } = setup({
    users: [account(SUPERVISOR_ID, { role: 'supervisor' })],
    vacated: [],
  });

  const result = await deleteUser(REQUESTER, SUPERVISOR_ID);

  assert.deepEqual(result, { id: SUPERVISOR_ID, vacated_flights: [] });
  assert.deepEqual(
    steps.map(([name]) => name),
    [
      'flights.releaseAssignments',
      'notification.deleteNotifications',
      'recommendation.deleteSuggestions',
      'crew.eraseUser',
      'admin.deleteUser',
    ]
  );
  assert.equal(stored.has(SUPERVISOR_ID), false);
});

for (const [step, service] of [
  ['flights', 'vuelos'],
  ['alert', 'notificaciones'],
  ['notification', 'notificaciones'],
  ['recommendation', 'recomendaciones'],
  ['crew', 'tripulación'],
]) {
  test(`EU-06: si falla ${step}, responde 502, la cuenta sigue y se registra en el log`, async (t) => {
    const logged = [];
    t.mock.method(console, 'error', (...args) => logged.push(args.join(' ')));
    const { deleteUser, steps, stored } = setup({ fail: { [step]: 1 } });

    await assert.rejects(deleteUser(REQUESTER, CREW_ID), (error) => {
      assert.equal(error.status, 502);
      assert.equal(error.code, 'user_delete_incomplete');
      assert.equal(
        error.message,
        `No se pudo eliminar el usuario: el servicio de ${service} no respondió. La cuenta sigue existiendo; vuelve a intentarlo.`
      );
      return true;
    });
    assert.equal(stored.has(CREW_ID), true);
    assert.equal(steps.some(([name]) => name === 'admin.deleteUser'), false);
    assert.ok(logged.some((line) => line.includes(CREW_ID)), 'falta el log');
  });
}

test('EU-06: tras el 502, un reintento termina el borrado', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { deleteUser, stored } = setup({ fail: { crew: 1 } });

  await assert.rejects(deleteUser(REQUESTER, CREW_ID), rejectsWith(502));
  await deleteUser(REQUESTER, CREW_ID);

  assert.equal(stored.has(CREW_ID), false);
});

test('si la alerta no sale, los vuelos sin aviso quedan en el log; el reintento ya no los ve', async (t) => {
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args.join(' ')));
  const { deleteUser, steps } = setup({ fail: { alert: 1 } });

  await assert.rejects(deleteUser(REQUESTER, CREW_ID), rejectsWith(502));
  assert.ok(logged.some((line) => line.includes('DL1102')), 'falta el vuelo sin aviso en el log');

  steps.length = 0;
  const retry = await deleteUser(REQUESTER, CREW_ID);

  // Flights ya liberó el puesto en el primer intento: el reintento no tiene a quién avisar.
  assert.deepEqual(retry.vacated_flights, []);
  assert.equal(steps.some(([name]) => name === 'notification.publishSlotVacated'), false);
});

// ------------------------------------------------------- clientes internos

test('flights, notification y recommendation reciben un token de servicio de admin', async () => {
  seen.length = 0;
  fakeRoutes = {
    [`DELETE /internal/users/${CREW_ID}/assignments`]: () => [
      200,
      { deleted: 2, restored: 0, vacated_flights: [VACATED] },
    ],
    'POST /internal/alerts/slot-vacated': () => [202, { type: 'flight:slot_vacated' }],
    [`DELETE /internal/users/${CREW_ID}/notifications`]: () => [200, { deleted: 1, reads_deleted: 0 }],
    [`DELETE /internal/users/${CREW_ID}/suggestions`]: () => [200, { deleted: 3 }],
  };

  const released = await internalClients.flightsClient.releaseAssignments(CREW_ID);
  await internalClients.notificationClient.publishSlotVacated(VACATED);
  await internalClients.notificationClient.deleteNotifications(CREW_ID);
  const suggestions = await internalClients.recommendationClient.deleteSuggestions(CREW_ID);

  assert.deepEqual(released.vacated_flights, [VACATED]);
  assert.deepEqual(suggestions, { deleted: 3 });
  assert.equal(seen.length, 4);
  for (const request of seen) {
    const payload = jwt.verify(request.headers.authorization.replace('Bearer ', ''), signingKey, {
      issuer: 'aircrew-admin',
    });
    assert.equal(payload.role, 'service');
    assert.equal(payload.sub, 'service:admin');
    assert.ok(payload.exp - payload.iat <= 60);
  }
});

test('cualquier respuesta que no sea 2xx (también un 404) es 502 para admin', async () => {
  fakeRoutes = {
    [`DELETE /internal/users/${CREW_ID}/suggestions`]: () => [500, { error: 'boom' }],
  };

  await assert.rejects(internalClients.recommendationClient.deleteSuggestions(CREW_ID), rejectsWith(502));
  await assert.rejects(internalClients.flightsClient.releaseAssignments(CREW_ID), rejectsWith(502));
});

test('crew borra con la clave de admin en /internal/users/:id', async () => {
  seen.length = 0;
  fakeRoutes = {
    [`DELETE /internal/users/${CREW_ID}`]: () => [
      200,
      { profile: 1, certifications: 1, absences: 2, reopened_absences: 0 },
    ],
  };

  const result = await crewClient.eraseUser(CREW_ID);

  assert.equal(result.absences, 2);
  assert.equal(seen[0].headers['x-service-key'], 'clave-de-admin');
});

test('crew: un 404 al borrar también es 502 (no es «usuario no encontrado»)', async () => {
  fakeRoutes = {};
  await assert.rejects(crewClient.eraseUser(CREW_ID), rejectsWith(502));
});

// ---------------------------------------------------------- repositorio

test('el borrado en admin: cuenta y fallos de login por su correo, en una transacción', async (t) => {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql: sql.trim(), params });
      if (/FROM public\.users\s+WHERE id = \$1/.test(sql) && /FOR UPDATE/.test(sql)) {
        return { rows: [{ role: 'crew', others: 0 }] };
      }
      if (/DELETE FROM public\.users/.test(sql)) return { rows: [{ email: 'd.salcedo@aircrew.test' }] };
      return { rows: [], rowCount: 2 };
    },
    release() {},
  };
  t.mock.method(pool, 'connect', async () => client);

  assert.equal(await userRepository.deleteUser(CREW_ID), 'deleted');

  assert.equal(queries[0].sql, 'BEGIN');
  assert.equal(queries.at(-1).sql, 'COMMIT');
  const failures = queries.find((q) => /DELETE FROM public\.login_failures/.test(q.sql));
  assert.deepEqual(failures.params, ['d.salcedo@aircrew.test']);
  const users = queries.find((q) => /DELETE FROM public\.users/.test(q.sql));
  assert.deepEqual(users.params, [CREW_ID]);
});

test('el borrado en admin no quita al último super_admin activo', async (t) => {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql: sql.trim(), params });
      if (/FOR UPDATE/.test(sql)) return { rows: [{ role: 'super_admin', others: 0 }] };
      return { rows: [] };
    },
    release() {},
  };
  t.mock.method(pool, 'connect', async () => client);

  assert.equal(await userRepository.deleteUser(OTHER_ADMIN_ID), 'last_super_admin');
  assert.equal(queries.some((q) => /DELETE FROM/.test(q.sql)), false);
  assert.equal(queries.at(-1).sql, 'ROLLBACK');
});

test('el borrado en admin de una cuenta que ya no existe responde not_found', async (t) => {
  const client = {
    async query(sql) {
      return { rows: [] };
    },
    release() {},
  };
  t.mock.method(pool, 'connect', async () => client);

  assert.equal(await userRepository.deleteUser(CREW_ID), 'not_found');
});

// ----------------------------------------------------------------- HTTP

function tokenFor(role, subject = ADMIN_ID) {
  return jwt.sign({ role }, signingKey, { subject, issuer: 'aircrew-admin', expiresIn: '1h' });
}

async function request(path, { method = 'DELETE', role } = {}) {
  const server = app.listen(0);
  await once(server, 'listening');
  try {
    const headers = role ? { Authorization: `Bearer ${tokenFor(role)}` } : {};
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('DELETE /users/:id/permanent: solo super_admin', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    throw new Error(`Consulta inesperada en el test: ${sql}`);
  });

  assert.equal((await request(`/users/${CREW_ID}/permanent`)).status, 401);
  for (const role of ['crew', 'supervisor']) {
    assert.equal((await request(`/users/${CREW_ID}/permanent`, { role })).status, 403, role);
  }
});

test('DELETE /users/:id/permanent: 404 con { error } si no existe', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(pool, 'query', async () => ({ rows: [] }));

  const res = await request(`/users/${CREW_ID}/permanent`, { role: 'super_admin' });

  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: 'Usuario no encontrado.' });
});

test('DELETE /users/:id/permanent: 409 con code si es la propia cuenta', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(pool, 'query', async () => ({
    rows: [account(ADMIN_ID, { role: 'super_admin' })],
  }));

  const res = await request(`/users/${ADMIN_ID}/permanent`, { role: 'super_admin' });

  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { error: 'No puedes eliminar tu propia cuenta.', code: 'cannot_delete_self' });
});
