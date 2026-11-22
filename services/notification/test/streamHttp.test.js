const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const jwt = require('jsonwebtoken');

// Antes de cargar la app: dotenv no pisa una variable que ya existe.
process.env.JWT_SECRET = 'secreto-de-prueba';
const app = require('../src/app');
const pool = require('../src/adapters/outbound/persistence/pool');

const CREW_ID = '11111111-1111-4111-8111-111111111111';

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
      headers: { Authorization: `Bearer ${tokenFor('crew', { expiresIn: '1s' })}` },
    });
    const sse = sseReader(response);
    const received = await sse.until('auth:expired', 4000);
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
