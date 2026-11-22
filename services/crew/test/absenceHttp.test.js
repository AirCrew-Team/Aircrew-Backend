const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const jwt = require('jsonwebtoken');

// Antes de cargar la app: dotenv no pisa una variable que ya existe.
process.env.JWT_SECRET = 'secreto-de-prueba';
const app = require('../src/app');

// Ningún caso llega a la base: todos terminan antes de guardar.
const ABSENCE_ID = '11111111-1111-4111-8111-111111111111';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function tokenFor(role) {
  return jwt.sign({ role }, 'secreto-de-prueba', {
    subject: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
    issuer: 'aircrew-admin',
    expiresIn: '1h',
  });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Body de unos 200 kB: un "PDF" que empieza con la firma PNG.
function bigBody() {
  const bytes = Buffer.concat([PNG_SIGNATURE, Buffer.alloc(150 * 1024, 1)]);
  return JSON.stringify({
    start_date: today(),
    end_date: today(),
    reason: 'illness',
    attachment: {
      file_name: 'comprobante.pdf',
      mime_type: 'application/pdf',
      data_base64: bytes.toString('base64'),
    },
  });
}

async function request(path, { method = 'GET', role, body } = {}) {
  const server = app.listen(0);
  await once(server, 'listening');
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (role) headers.Authorization = `Bearer ${tokenFor(role)}`;
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers,
      body,
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('AU-B5 (HTTP): POST /absences acepta un body de más de 100 kB y valida el adjunto (400, no 413)', async (t) => {
  t.mock.method(console, 'error', () => {});
  const body = bigBody();
  assert.ok(body.length > 100 * 1024);

  const res = await request('/absences', { method: 'POST', role: 'crew', body });

  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'El archivo no coincide con el tipo de comprobante indicado.');
});

// Pasa el límite de 15 MB: si el body se leyera antes de la sesión, sería 413.
function tooBigBody() {
  return JSON.stringify({ notes: 'a'.repeat(15 * 1024 * 1024 + 1) });
}

test('POST /absences sin sesión responde 401 sin leer un body de más de 15 MB', async (t) => {
  t.mock.method(console, 'error', () => {});

  const res = await request('/absences', { method: 'POST', body: tooBigBody() });

  assert.equal(res.status, 401);
});

test('POST /absences responde 413 con un body de más de 15 MB', async (t) => {
  t.mock.method(console, 'error', () => {});

  const res = await request('/absences', { method: 'POST', role: 'crew', body: tooBigBody() });

  assert.equal(res.status, 413);
});

test('las demás rutas mantienen el límite de 100 kB', async (t) => {
  t.mock.method(console, 'error', () => {});

  const res = await request(`/absences/${ABSENCE_ID}/cover`, {
    method: 'PATCH',
    role: 'supervisor',
    body: bigBody(),
  });

  assert.equal(res.status, 413);
});

test('AU-B8 (HTTP): GET /absences/:id/attachment responde 403 a un tripulante', async () => {
  const res = await request(`/absences/${ABSENCE_ID}/attachment`, { role: 'crew' });

  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { error: 'No tienes permisos para esta acción.', code: 'forbidden' });
});
