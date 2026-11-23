const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const http = require('node:http');
const jwt = require('jsonwebtoken');

// Antes de cargar la app: dotenv no pisa una variable que ya existe.
process.env.JWT_SECRET = 'secreto-de-prueba';

const CREW_ID = '11111111-1111-4111-8111-111111111111';

// Admin falso (GET /users/me): las preferencias de cada persona según el sub del token.
// Sin entrada, el perfil trae notifications null (no filtra nada).
const PREFERENCES = new Map();
let adminServer;
let app;
let pool;

before(async () => {
  adminServer = http.createServer((req, res) => {
    const token = (req.headers.authorization || '').slice('Bearer '.length);
    const payload = jwt.decode(token);
    res.writeHead(req.url === '/users/me' && payload ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload ? { id: payload.sub, notifications: PREFERENCES.get(payload.sub) || null } : {}));
  });
  adminServer.listen(0, '127.0.0.1');
  await once(adminServer, 'listening');
  // config/env lee ADMIN_SERVICE_URL al cargarse: nada de src antes de esta línea.
  process.env.ADMIN_SERVICE_URL = `http://127.0.0.1:${adminServer.address().port}`;
  app = require('../src/app');
  pool = require('../src/adapters/outbound/persistence/pool');
});

after(() => {
  adminServer.closeAllConnections();
  adminServer.close();
});

function tokenFor(role, { sub = CREW_ID, expiresIn = '1h' } = {}) {
  return jwt.sign({ role }, 'secreto-de-prueba', { subject: sub, issuer: 'aircrew-admin', expiresIn });
}

async function withServer(t, fn) {
  const server = app.listen(0);
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return fn(`http://127.0.0.1:${server.address().port}`);
}

// Lector de una conexión SSE que queda abierta: until(text) espera a que llegue `text`
// (o a que el servidor cierre) y devuelve todo lo recibido hasta ahí.
function sseReader(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = '';
  let closed = false;

  async function until(text, timeoutMs = 4000) {
    const deadline = Date.now() + timeoutMs;
    while (!received.includes(text) && !closed && Date.now() < deadline) {
      const result = await Promise.race([
        reader.read(),
        new Promise((resolve) => setTimeout(() => resolve(null), deadline - Date.now())),
      ]);
      if (!result) break;
      if (result.done) closed = true;
      if (result.value) received += decoder.decode(result.value, { stream: true });
    }
    return received;
  }

  return { until, isClosed: () => closed, cancel: () => reader.cancel().catch(() => {}) };
}

test('GET /stream sin sesión, con token inválido o de servicio no abre la conexión', async (t) => {
  await withServer(t, async (base) => {
    assert.equal((await fetch(`${base}/stream`)).status, 401);
    assert.equal((await fetch(`${base}/stream`, { headers: { Authorization: 'Bearer basura' } })).status, 401);
    const service = await fetch(`${base}/stream`, { headers: { Authorization: `Bearer ${tokenFor('service')}` } });
    assert.equal(service.status, 403);
  });
});

test('GET /stream abre la conexión SSE con la cookie y confirma «connected»', async (t) => {
  await withServer(t, async (base) => {
    const controller = new AbortController();
    const response = await fetch(`${base}/stream`, {
      headers: { Cookie: `aircrew_token=${tokenFor('crew')}` },
      signal: controller.signal,
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    assert.match(response.headers.get('cache-control'), /no-transform/);
    const sse = sseReader(response);
    assert.match(await sse.until('event: connected'), /event: connected/);
    controller.abort();
  });
});

test('de punta a punta: crew avisa la certificación y el tripulante la recibe en vivo y en su historial', async (t) => {
  const inserts = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    if (sql.includes('INSERT INTO public.notifications')) {
      inserts.push(params);
      return { rows: [{ id: '33333333-3333-4333-8333-333333333333', created_at: '2026-11-22T10:00:00.000Z' }] };
    }
    throw new Error(`Consulta inesperada: ${sql}`);
  });

  await withServer(t, async (base) => {
    const controller = new AbortController();
    const stream = await fetch(`${base}/stream`, {
      headers: { Authorization: `Bearer ${tokenFor('crew')}` },
      signal: controller.signal,
    });
    const sse = sseReader(stream);
    await sse.until('event: connected');

    const post = await fetch(`${base}/events/certification`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenFor('service', { sub: 'crew' })}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ crew_user_id: CREW_ID, event: 'verified', license_number: '2775981' }),
    });
    const body = await post.json();
    assert.equal(post.status, 202);
    assert.equal(body.delivered_to, 1);
    assert.equal(body.saved, true);

    const received = await sse.until('certification:verified');
    assert.match(received, /event: certification:verified/);
    assert.match(received, /Tu certificado 2775981 fue verificado\./);
    assert.equal(inserts[0][0], CREW_ID);
    controller.abort();
  });
});

test('el aviso de certificación solo lo puede enviar un servicio', async (t) => {
  await withServer(t, async (base) => {
    for (const role of ['crew', 'supervisor', 'super_admin']) {
      const res = await fetch(`${base}/events/certification`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenFor(role)}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ crew_user_id: CREW_ID, event: 'registered' }),
      });
      assert.equal(res.status, 403, role);
    }
  });
});

test('antes de que venza la sesión llega «auth:expired» y se cierra la conexión', async (t) => {
  await withServer(t, async (base) => {
    const response = await fetch(`${base}/stream`, {
      headers: { Authorization: `Bearer ${tokenFor('crew', { expiresIn: '3s' })}` },
    });
    const sse = sseReader(response);
    const received = await sse.until('auth:expired', 6000);
    assert.match(received, /event: auth:expired/);
    // Y el servidor cierra la conexión.
    await sse.until('__nunca__', 1000);
    assert.equal(sse.isClosed(), true);
  });
});

test('la campana exige sesión de usuario', async (t) => {
  await withServer(t, async (base) => {
    assert.equal((await fetch(`${base}/notifications`)).status, 401);
    const service = await fetch(`${base}/notifications`, { headers: { Authorization: `Bearer ${tokenFor('service')}` } });
    assert.equal(service.status, 403);
  });
});

// ---------------------------------------- BE-6: preferencias y super_admin

const SUPERVISOR_ID = '44444444-4444-4444-8444-444444444444';
const HISTORY_ID = '55555555-5555-4555-8555-555555555555';
const ADMIN_ID = '66666666-6666-4666-8666-666666666666';

test('el super_admin recibe 403 en /stream y en la campana', async (t) => {
  await withServer(t, async (base) => {
    const headers = { Authorization: `Bearer ${tokenFor('super_admin', { sub: ADMIN_ID })}` };
    for (const path of ['/stream', '/notifications', '/notifications/read-all']) {
      const res = await fetch(`${base}${path}`, { method: path.endsWith('read-all') ? 'POST' : 'GET', headers });
      assert.equal(res.status, 403, path);
      assert.deepEqual(await res.json(), { error: 'El super_admin no recibe notificaciones.', code: 'forbidden' });
    }
  });
});

test('un supervisor que apagó «ausencia reportada» no la recibe en vivo, pero sí las demás', async (t) => {
  PREFERENCES.set(SUPERVISOR_ID, { absence_reported: false, absence_covered: true });
  t.mock.method(pool, 'query', async (sql) => {
    if (sql.includes('INSERT INTO public.notifications')) {
      return { rows: [{ id: '33333333-3333-4333-8333-333333333333', created_at: '2026-11-22T10:00:00.000Z' }] };
    }
    throw new Error(`Consulta inesperada: ${sql}`);
  });
  const absence = { id: '77777777-7777-4777-8777-777777777777', start_date: '2026-11-25', end_date: '2026-11-26', reason: 'fatigue' };

  await withServer(t, async (base) => {
    const controller = new AbortController();
    const stream = await fetch(`${base}/stream`, {
      headers: { Authorization: `Bearer ${tokenFor('supervisor', { sub: SUPERVISOR_ID })}` },
      signal: controller.signal,
    });
    const sse = sseReader(stream);
    await sse.until('event: connected');

    const reported = await fetch(`${base}/events/absence-reported`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenFor('crew')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ absence }),
    });
    assert.equal(reported.status, 202);
    assert.equal((await reported.json()).delivered_to, 0);

    const covered = await fetch(`${base}/events/absence-covered`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenFor('service', { sub: 'recommendation' })}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ absence }),
    });
    assert.equal((await covered.json()).delivered_to, 1);

    const received = await sse.until('absence:covered');
    assert.match(received, /event: absence:covered/);
    assert.doesNotMatch(received, /absence:reported/);
    controller.abort();
  });
});

test('la campana de un supervisor excluye de la lista y del contador «ausencia reportada» si la apagó', async (t) => {
  PREFERENCES.set(HISTORY_ID, { absence_reported: false, absence_covered: true });
  const queries = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    queries.push([sql, params]);
    return sql.includes('count(*)') ? { rows: [{ unread: 0 }] } : { rows: [] };
  });

  await withServer(t, async (base) => {
    const res = await fetch(`${base}/notifications`, {
      headers: { Authorization: `Bearer ${tokenFor('supervisor', { sub: HISTORY_ID })}` },
    });
    assert.equal(res.status, 200);
  });

  assert.equal(queries.length, 2);
  for (const [sql, params] of queries) {
    assert.match(sql, /n\.type <> ALL\(\$\d+::text\[\]\)/);
    assert.deepEqual(params[params.length - 1], ['absence:reported']);
  }
});
