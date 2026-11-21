const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const jwt = require('jsonwebtoken');

// Antes de cargar la app: dotenv no pisa una variable que ya existe.
process.env.JWT_SECRET = 'secreto-de-prueba';
process.env.ADMIN_SERVICE_KEY = 'clave-de-admin';

const {
  createCrewProfile,
  validateCrewProfileUpdate,
} = require('../src/domain/entities/crewMember');
const createManageCrewProfiles = require('../src/application/use-cases/manageCrewProfiles');
const app = require('../src/app');

const USER_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

function rejectsWith(status, message) {
  return (error) => {
    assert.equal(error.status, status);
    if (message) assert.match(error.message, message);
    return true;
  };
}

// ---------------------------------------------------------------- dominio

test('el perfil nuevo normaliza el código y la base, y empieza en su base', () => {
  const profile = createCrewProfile({
    user_id: USER_ID,
    employee_code: ' ac-1108 ',
    position: ' Comandante ',
    base: 'atl',
  });

  assert.deepEqual(profile, {
    userId: USER_ID,
    employeeCode: 'AC-1108',
    position: 'Comandante',
    base: 'ATL',
    currentLocation: 'ATL',
    status: 'available',
  });
});

test('el perfil nuevo exige user_id, código y cargo válidos', () => {
  const valid = { user_id: USER_ID, employee_code: 'AC-1108', position: 'Copiloto' };

  assert.throws(() => createCrewProfile({ ...valid, user_id: 'no-es-uuid' }), /user_id/);
  assert.throws(() => createCrewProfile({ ...valid, employee_code: 'A' }), /employee_code/);
  assert.throws(() => createCrewProfile({ ...valid, employee_code: 'AC 1108' }), /employee_code/);
  assert.throws(() => createCrewProfile({ ...valid, position: '  ' }), /position/);
  assert.throws(() => createCrewProfile({ ...valid, position: 'x'.repeat(41) }), /position/);
  assert.throws(() => createCrewProfile({ ...valid, base: 'ATLA' }), /base/);
  assert.throws(() => createCrewProfile({ ...valid, status: 'flying' }), /status/);
});

test('sin base, el perfil queda sin base ni ubicación', () => {
  const profile = createCrewProfile({ user_id: USER_ID, employee_code: 'AC-1', position: 'Sobrecargo', base: '' });

  assert.equal(profile.base, null);
  assert.equal(profile.currentLocation, null);
});

test('editar solo toma los campos enviados', () => {
  assert.deepEqual(validateCrewProfileUpdate({ base: 'sea', status: 'on_duty' }), {
    base: 'SEA',
    status: 'on_duty',
  });
  assert.deepEqual(validateCrewProfileUpdate({ base: null }), { base: null });
  assert.deepEqual(validateCrewProfileUpdate({ is_active: false }), { isActive: false });
  assert.throws(() => validateCrewProfileUpdate({}), /Envía al menos uno/);
  assert.throws(() => validateCrewProfileUpdate({ is_active: 'no' }), /is_active/);
});

// ---------------------------------------------------------- caso de uso

function setup({ deleteResult = 'deleted', updated = { user_id: USER_ID } } = {}) {
  const calls = [];
  const crewRepository = {
    async createCrewMember(data) {
      calls.push(['create', data]);
      return { user_id: data.userId };
    },
    async updateCrewMember(userId, changes) {
      calls.push(['update', userId, changes]);
      return updated;
    },
    async deleteCrewMemberWithoutHistory(userId) {
      calls.push(['delete', userId]);
      return deleteResult;
    },
    async findCrewMembers() {
      return [];
    },
  };
  return { calls, profiles: createManageCrewProfiles(crewRepository) };
}

test('crear un perfil inválido no llega al repositorio', async () => {
  const { calls, profiles } = setup();

  await assert.rejects(
    async () => profiles.createProfile({ user_id: USER_ID, employee_code: 'AC-1' }),
    rejectsWith(400, /position/)
  );
  assert.deepEqual(calls, []);
});

test('editar un perfil inexistente responde 404', async () => {
  const { profiles } = setup({ updated: null });

  await assert.rejects(profiles.updateProfile(USER_ID, { status: 'on_duty' }), rejectsWith(404));
  await assert.rejects(profiles.updateProfile('no-es-uuid', { status: 'on_duty' }), rejectsWith(404));
});

test('borrar: un perfil con ausencias no se borra (409); uno inexistente es 404', async () => {
  await setup().profiles.deleteProfile(USER_ID);
  await assert.rejects(
    setup({ deleteResult: 'has_history' }).profiles.deleteProfile(USER_ID),
    rejectsWith(409, /ausencias/)
  );
  await assert.rejects(setup({ deleteResult: 'not_found' }).profiles.deleteProfile(USER_ID), rejectsWith(404));
});

// ------------------------------------------------------------------- HTTP

async function request(path, { method = 'GET', headers = {}, body } = {}) {
  const server = app.listen(0);
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
    });
    const text = await response.text();
    const isJson = (response.headers.get('content-type') || '').includes('json');
    return { status: response.status, body: isJson && text ? JSON.parse(text) : text };
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('las rutas internas exigen la clave de Admin, no una sesión', async () => {
  const superAdminToken = jwt.sign({ role: 'super_admin' }, 'secreto-de-prueba', {
    subject: USER_ID,
    issuer: 'aircrew-admin',
    expiresIn: '1h',
  });

  for (const headers of [{}, { Authorization: `Bearer ${superAdminToken}` }, { 'x-service-key': 'otra' }]) {
    for (const [method, path] of [
      ['GET', '/internal/crew-members'],
      ['POST', '/internal/crew-members'],
      ['PATCH', `/internal/crew-members/${USER_ID}`],
      ['DELETE', `/internal/crew-members/${USER_ID}`],
    ]) {
      const res = await request(path, { method, headers, body: method === 'POST' || method === 'PATCH' ? '{}' : undefined });
      assert.equal(res.status, 401, `${method} ${path} ${JSON.stringify(headers)}`);
    }
  }
});

test('con la clave, un alta inválida responde 400 antes de guardar', async (t) => {
  t.mock.method(console, 'error', () => {});

  const res = await request('/internal/crew-members', {
    method: 'POST',
    headers: { 'x-service-key': 'clave-de-admin' },
    body: JSON.stringify({ user_id: USER_ID, employee_code: 'AC-1108' }),
  });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /position/);
});

test('POST /crew-members ya no existe: el alta la hace Admin', async () => {
  const token = jwt.sign({ role: 'super_admin' }, 'secreto-de-prueba', {
    subject: USER_ID,
    issuer: 'aircrew-admin',
    expiresIn: '1h',
  });

  const res = await request('/crew-members', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: '{}',
  });

  assert.equal(res.status, 404);
});
