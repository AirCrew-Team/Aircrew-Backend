const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const jwt = require('jsonwebtoken');

// BE-7: GET /certifications/me, la certificación del propio tripulante (pantalla
// Certificaciones y tarjeta del Inicio). Solo rol crew y solo sus datos.
process.env.JWT_SECRET = 'secreto-de-prueba';
const app = require('../src/app');
const pool = require('../src/adapters/outbound/persistence/pool');
const createManageCertifications = require('../src/application/use-cases/manageCertifications');

const CREW_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const OTHER_ID = '11111111-1111-4111-8111-111111111111';
const CREW = { id: CREW_ID, role: 'crew' };

const PILOT = {
  user_id: CREW_ID,
  employee_code: 'AC-1108',
  position: 'Comandante',
  base: 'ATL',
  is_active: true,
  medical_expires_on: '2027-05-18',
  ratings: ['A320', '787'],
  english_level: 5,
};

function setup(record) {
  const calls = { findCrewCertification: [], findUsersByIds: 0, findHistory: 0 };
  const manage = createManageCertifications({
    certificationRepository: {
      findCrewCertification: async (id) => {
        calls.findCrewCertification.push(id);
        return record;
      },
      findHistory: async () => {
        calls.findHistory += 1;
        return [];
      },
    },
    findUsersByIds: async () => {
      calls.findUsersByIds += 1;
      return [];
    },
  });
  return { manage, calls };
}

// ------------------------------------------------------------- caso de uso

test('el tripulante ve su certificación con el nombre de cada certificado y su médico', async () => {
  const { manage, calls } = setup({
    member: PILOT,
    certification: {
      license_number: '2775981',
      certificates: ['ATP', 'IR'],
      status: 'verified',
      updated_at: '2026-11-01T10:00:00.000Z',
      file: { file_name: 'licencia.pdf', mime_type: 'application/pdf', size_bytes: 1200 },
    },
  });

  const mine = await manage.getMyCertification(CREW);

  assert.deepEqual(calls.findCrewCertification, [CREW_ID]);
  assert.deepEqual(mine, {
    user_id: CREW_ID,
    employee_code: 'AC-1108',
    position: 'Comandante',
    area: 'flight_deck',
    base: 'ATL',
    status: 'verified',
    license_number: '2775981',
    certificates: ['ATP', 'IR'],
    certificate_details: [
      { code: 'ATP', name: 'Airline Transport Pilot (ATP)', short: 'ATP', is_license: true },
      { code: 'IR', name: 'Instrument Rating (IR)', short: 'IR', is_license: false },
    ],
    file: { file_name: 'licencia.pdf', mime_type: 'application/pdf', size_bytes: 1200 },
    updated_at: '2026-11-01T10:00:00.000Z',
    medical_expires_on: '2027-05-18',
    ratings: ['A320', '787'],
    english_level: 5,
  });
});

test('no pide nombres a Admin ni el historial (lleva datos del super_admin)', async () => {
  const { manage, calls } = setup({ member: PILOT, certification: null });

  const mine = await manage.getMyCertification(CREW);

  assert.equal(calls.findUsersByIds, 0);
  assert.equal(calls.findHistory, 0);
  for (const field of ['name', 'email', 'history']) assert.equal(field in mine, false, field);
});

test('en cabina el CDP es la licencia; sin certificación queda «sin certificado»', async () => {
  const attendant = { ...PILOT, position: 'Sobrecargo', ratings: [], english_level: null, medical_expires_on: null };
  const certified = setup({
    member: attendant,
    certification: { license_number: '55443', certificates: ['CDP', 'LID'], status: 'pending_verification', updated_at: 'x', file: null },
  });
  const detail = (await certified.manage.getMyCertification(CREW)).certificate_details;
  assert.deepEqual(detail.map(({ code, is_license }) => [code, is_license]), [['CDP', true], ['LID', false]]);

  const empty = await setup({ member: attendant, certification: null }).manage.getMyCertification(CREW);
  assert.equal(empty.status, 'uncertified');
  assert.equal(empty.area, 'cabin');
  assert.equal(empty.license_number, null);
  assert.deepEqual(empty.certificates, []);
  assert.deepEqual(empty.certificate_details, []);
  assert.equal(empty.file, null);
  assert.equal(empty.updated_at, null);
});

test('sin perfil de tripulante responde 404', async () => {
  const { manage } = setup(null);
  await assert.rejects(manage.getMyCertification(CREW), { status: 404, message: 'No tienes un perfil de tripulante.' });
});

// -------------------------------------------------------------------- HTTP

function tokenFor(role) {
  return jwt.sign({ role }, 'secreto-de-prueba', { subject: CREW_ID, issuer: 'aircrew-admin', expiresIn: '1h' });
}

async function request(path, { role } = {}) {
  const server = app.listen(0);
  await once(server, 'listening');
  try {
    const headers = role ? { Authorization: `Bearer ${tokenFor(role)}` } : {};
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { headers });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

function mockQuery(t, rows) {
  const queries = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    queries.push({ sql, params });
    return { rows };
  });
  t.mock.method(pool, 'connect', async () => {
    throw new Error('Conexión inesperada en el test.');
  });
  return queries;
}

test('GET /certifications/me exige sesión', async (t) => {
  mockQuery(t, []);
  assert.equal((await request('/certifications/me')).status, 401);
});

test('GET /certifications/me: el supervisor, el super_admin y un servicio reciben 403', async (t) => {
  const queries = mockQuery(t, []);
  for (const role of ['supervisor', 'super_admin', 'service']) {
    const res = await request('/certifications/me', { role });
    assert.equal(res.status, 403, role);
  }
  assert.equal(queries.length, 0);
});

test('GET /certifications/me: el tripulante recibe solo la suya, aunque pida otro user_id', async (t) => {
  const queries = mockQuery(t, [
    {
      ...PILOT,
      license_number: '2775981',
      certificates: ['ATP'],
      status: 'verified',
      certified_at: '2026-10-01T10:00:00.000Z',
      updated_at: '2026-11-01T10:00:00.000Z',
      file: null,
    },
  ]);

  const res = await request(`/certifications/me?user_id=${OTHER_ID}`, { role: 'crew' });

  assert.equal(res.status, 200);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].params, [CREW_ID]);
  assert.doesNotMatch(queries[0].sql, /\bf\.data\b/);
  assert.equal(res.body.user_id, CREW_ID);
  assert.equal(res.body.license_number, '2775981');
  assert.equal(res.body.medical_expires_on, '2027-05-18');
  assert.deepEqual(res.body.ratings, ['A320', '787']);
  assert.equal(res.body.english_level, 5);
});

test('GET /certifications/me sin perfil de tripulante responde 404', async (t) => {
  t.mock.method(console, 'error', () => {});
  mockQuery(t, []);
  const res = await request('/certifications/me', { role: 'crew' });
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'No tienes un perfil de tripulante.');
});
