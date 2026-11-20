const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const jwt = require('jsonwebtoken');

// Antes de cargar la app: dotenv no pisa una variable que ya existe.
const signingKey = 'prueba'.repeat(4);
process.env.JWT_SECRET = signingKey;
const app = require('../src/app');
const pool = require('../src/adapters/outbound/persistence/pool');

const USER_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const KB = 1024;
const MB = 1024 * KB;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);

function tokenFor(role) {
  return jwt.sign({ role }, signingKey, {
    subject: USER_ID,
    issuer: 'aircrew-admin',
    expiresIn: '1h',
  });
}

// Ninguna consulta llega a PostgreSQL: responde `query` o el test falla.
function useDatabase(t, query = async (sql) => {
  throw new Error(`Consulta inesperada en el test: ${sql}`);
}) {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql, params });
    return query(sql, params);
  });
  t.mock.method(pool, 'connect', async () => {
    throw new Error('Conexión inesperada en el test.');
  });
  return calls;
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
    const bytes = Buffer.from(await response.arrayBuffer());
    const isJson = (response.headers.get('content-type') || '').includes('application/json');
    return {
      status: response.status,
      headers: response.headers,
      bytes,
      body: isJson ? JSON.parse(bytes.toString('utf8')) : null,
    };
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

// Fila de findProfileById para una cuenta activa.
const PROFILE_ROW = {
  id: USER_ID,
  name: 'Ana Pérez',
  email: 'ana@aircrew.test',
  role: 'crew',
  is_active: true,
  created_at: new Date('2026-01-10T15:00:00Z'),
  phone: null,
  residence: null,
  password_changed_at: null,
  photo_updated_at: null,
  notify_absence_reported: true,
  notify_absence_covered: true,
  notify_replacement_assigned: false,
};

// Rutas de la foto: primero comprueban la cuenta y después leen o borran la foto.
function photoQueries({ isActive = true, photo = null } = {}) {
  return async (sql) => {
    if (/FROM public\.users u/.test(sql)) return { rows: [{ ...PROFILE_ROW, is_active: isActive }] };
    if (/DELETE FROM public\.user_photos/.test(sql)) return { rows: [], rowCount: photo ? 1 : 0 };
    if (/FROM public\.user_photos/.test(sql)) return { rows: photo ? [photo] : [] };
    throw new Error(`Consulta inesperada en el test: ${sql}`);
  };
}

// Body de unos 150 kB: un "PNG" que empieza con la firma JPEG.
function bigPhotoBody() {
  const bytes = Buffer.concat([JPEG, Buffer.alloc(150 * KB, 1)]);
  return JSON.stringify({ mime_type: 'image/png', data_base64: bytes.toString('base64') });
}

// Pasa el límite de 3 MB de la foto.
function tooBigBody() {
  return JSON.stringify({ mime_type: 'image/png', data_base64: 'A'.repeat(3 * MB + 4) });
}

// --- GET /users/me ---

test('CF-B1 (HTTP): GET /users/me sin sesión responde 401', async (t) => {
  useDatabase(t);

  const res = await request('/users/me');

  assert.equal(res.status, 401);
  assert.deepEqual(res.body, { error: 'Se requiere autenticación.' });
});

test('CF-B1 (HTTP): GET /users/me de un tripulante responde 200 con el contrato, no el 403 de /users/:id', async (t) => {
  const calls = useDatabase(t, async () => ({ rows: [PROFILE_ROW] }));

  const res = await request('/users/me', { role: 'crew' });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    id: USER_ID,
    name: 'Ana Pérez',
    email: 'ana@aircrew.test',
    role: 'crew',
    is_active: true,
    created_at: '2026-01-10T15:00:00.000Z',
    phone: null,
    residence: null,
    password_changed_at: null,
    photo_updated_at: null,
    notifications: { replacement_assigned: false },
    employment: null,
  });
  assert.deepEqual(calls[0].params, [USER_ID]);
});

test('CF-B7 (HTTP): GET /users/me de un supervisor trae employment con sus datos laborales', async (t) => {
  const calls = useDatabase(t, async () => ({
    rows: [
      {
        ...PROFILE_ROW,
        role: 'supervisor',
        employee_code: 'SUP-001',
        base: 'ATL',
        shift: 'night',
        operational_status: 'available',
      },
    ],
  }));

  const res = await request('/users/me', { role: 'supervisor' });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.employment, {
    employee_code: 'SUP-001',
    base: 'ATL',
    shift: 'night',
    operational_status: 'available',
  });
  assert.match(calls[0].sql, /u\.employee_code, u\.base, u\.shift, u\.operational_status/);
});

test('CF-B7 (HTTP): GET /users/me de un super_admin trae employment null', async (t) => {
  useDatabase(t, async () => ({ rows: [{ ...PROFILE_ROW, role: 'super_admin' }] }));

  const res = await request('/users/me', { role: 'super_admin' });

  assert.equal(res.status, 200);
  assert.equal(res.body.employment, null);
});

test('CF-B9 (HTTP): GET /users/me de un super_admin trae notifications null', async (t) => {
  useDatabase(t, async () => ({ rows: [{ ...PROFILE_ROW, role: 'super_admin' }] }));

  const res = await request('/users/me', { role: 'super_admin' });

  assert.equal(res.status, 200);
  assert.ok('notifications' in res.body);
  assert.equal(res.body.notifications, null);
});

test('CF-B9 (HTTP): GET /users/me de un supervisor sigue trayendo sus dos preferencias', async (t) => {
  useDatabase(t, async () => ({ rows: [{ ...PROFILE_ROW, role: 'supervisor' }] }));

  const res = await request('/users/me', { role: 'supervisor' });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.notifications, { absence_reported: true, absence_covered: true });
});

// --- PATCH /users/me ---

test('CF-B9 (HTTP): PATCH /users/me de un super_admin con notifications responde 400 sin consultar la base', async (t) => {
  t.mock.method(console, 'error', () => {});
  const calls = useDatabase(t);

  const res = await request('/users/me', {
    method: 'PATCH',
    role: 'super_admin',
    body: JSON.stringify({ notifications: { absence_reported: false } }),
  });

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, {
    error: 'Hay una preferencia de notificaciones que no corresponde a tu rol.',
  });
  assert.deepEqual(calls, []);
});

test('CF-B2 (HTTP): PATCH /users/me de un tripulante con un celular inválido responde 400, no el 403 de /users/:id', async (t) => {
  useDatabase(t);

  const res = await request('/users/me', {
    method: 'PATCH',
    role: 'crew',
    body: JSON.stringify({ phone: '123' }),
  });

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, {
    error: 'El celular debe tener de 7 a 15 dígitos y puede empezar con +.',
  });
});

test('CF-B2 (HTTP): PATCH /users/me de un tripulante con absence_reported responde 400', async (t) => {
  useDatabase(t);

  const res = await request('/users/me', {
    method: 'PATCH',
    role: 'crew',
    body: JSON.stringify({ notifications: { absence_reported: true } }),
  });

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, {
    error: 'Hay una preferencia de notificaciones que no corresponde a tu rol.',
  });
});

test('CF-B8 (HTTP): PATCH /users/me con una ciudad que no está en el catálogo responde 400 sin consultar la base', async (t) => {
  t.mock.method(console, 'error', () => {});
  useDatabase(t);

  const res = await request('/users/me', {
    method: 'PATCH',
    role: 'crew',
    body: JSON.stringify({ residence: 'Bogotá' }),
  });

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: 'Elige una ciudad de Estados Unidos de la lista.' });
});

test('CF-B8 (HTTP): PATCH /users/me con una ciudad del catálogo la guarda con la forma del catálogo', async (t) => {
  const calls = useDatabase(t, async (sql, params) => ({
    rows: [{ ...PROFILE_ROW, residence: params[4] }],
  }));

  const res = await request('/users/me', {
    method: 'PATCH',
    role: 'crew',
    body: JSON.stringify({ residence: 'new york, ny' }),
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.residence, 'New York, NY');
  // D4: antes de guardar lee la cuenta; el UPDATE es la segunda consulta.
  const update = calls.find(({ sql }) => sql.includes('UPDATE public.users'));
  assert.equal(update.params[4], 'New York, NY');
});

test('CF-B2 (HTTP): PATCH /users/me sin sesión responde 401', async (t) => {
  useDatabase(t);

  const res = await request('/users/me', {
    method: 'PATCH',
    body: JSON.stringify({ residence: 'Cali' }),
  });

  assert.equal(res.status, 401);
});

test('CF-B5 (HTTP): las demás rutas mantienen el límite de 100 kB', async (t) => {
  t.mock.method(console, 'error', () => {});
  useDatabase(t);

  const res = await request('/users/me', { method: 'PATCH', role: 'crew', body: bigPhotoBody() });

  assert.equal(res.status, 413);
});

// --- GET /catalogs/us-cities ---

test('CF-B8 (HTTP): GET /catalogs/us-cities sin sesión responde 401', async (t) => {
  useDatabase(t);

  const res = await request('/catalogs/us-cities');

  assert.equal(res.status, 401);
  assert.deepEqual(res.body, { error: 'Se requiere autenticación.' });
});

for (const role of ['crew', 'supervisor', 'super_admin']) {
  test(`CF-B8 (HTTP): GET /catalogs/us-cities con sesión de ${role} devuelve el catálogo sin consultar la base`, async (t) => {
    const calls = useDatabase(t);
    const { US_CITIES } = require('../src/domain/usCities');

    const res = await request('/catalogs/us-cities', { role });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, [...US_CITIES]);
    assert.ok(res.body.includes('Atlanta, GA'));
    assert.deepEqual(calls, []);
  });
}

// --- POST /auth/change-password ---

test('CF-B3 (HTTP): POST /auth/change-password sin sesión responde 401', async (t) => {
  useDatabase(t);

  const res = await request('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ current_password: 'a'.repeat(12), new_password: 'b'.repeat(12) }),
  });

  assert.equal(res.status, 401);
});

test('CF-B3 (HTTP): una nueva contraseña de menos de 12 caracteres responde 400 sin consultar la base', async (t) => {
  t.mock.method(console, 'error', () => {});
  useDatabase(t);

  const res = await request('/auth/change-password', {
    method: 'POST',
    role: 'supervisor',
    body: JSON.stringify({ current_password: 'a'.repeat(12), new_password: 'b'.repeat(11) }),
  });

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, {
    error: 'Se requieren la contraseña actual y una nueva de 12 a 72 bytes.',
  });
  assert.equal(res.headers.get('set-cookie'), null);
});

// --- PUT /users/me/photo ---

test('CF-B5 (HTTP): PUT /users/me/photo acepta un body de más de 100 kB y valida la firma (400, no 413)', async (t) => {
  t.mock.method(console, 'error', () => {});
  useDatabase(t);
  const body = bigPhotoBody();
  assert.ok(body.length > 100 * KB);

  const res = await request('/users/me/photo', { method: 'PUT', role: 'crew', body });

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: 'El archivo no coincide con el tipo de foto indicado.' });
});

test('CF-B5 (HTTP): una foto de 2 MB + 1 byte cabe en el body y responde 400 por el tamaño, no 413', async (t) => {
  t.mock.method(console, 'error', () => {});
  useDatabase(t);
  const bytes = Buffer.concat([PNG, Buffer.alloc(2 * MB - PNG.length + 1, 1)]);

  const res = await request('/users/me/photo', {
    method: 'PUT',
    role: 'crew',
    body: JSON.stringify({ mime_type: 'image/png', data_base64: bytes.toString('base64') }),
  });

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: 'La foto no puede pesar más de 2 MB.' });
});

test('CF-B5 (HTTP): PUT /users/me/photo sin sesión responde 401 sin leer un body de más de 3 MB', async (t) => {
  useDatabase(t);

  const res = await request('/users/me/photo', { method: 'PUT', body: tooBigBody() });

  assert.equal(res.status, 401);
});

test('CF-B5 (HTTP): PUT /users/me/photo responde 413 con un body de más de 3 MB', async (t) => {
  t.mock.method(console, 'error', () => {});
  useDatabase(t);

  const res = await request('/users/me/photo', { method: 'PUT', role: 'crew', body: tooBigBody() });

  assert.equal(res.status, 413);
});

test('CF-B5 (HTTP): PUT /users/me/photo guarda un PNG y responde 200 con photo_updated_at', async (t) => {
  const updatedAt = new Date('2026-11-20T12:00:00Z');
  // D4: antes de guardar lee la cuenta; responde según el SQL.
  const calls = useDatabase(t, async (sql) => {
    if (/FROM public\.users u/.test(sql)) return { rows: [{ ...PROFILE_ROW, role: 'supervisor' }] };
    if (/INSERT INTO public\.user_photos/.test(sql)) {
      return { rows: [{ updated_at: updatedAt }], rowCount: 1 };
    }
    throw new Error(`Consulta inesperada en el test: ${sql}`);
  });
  const data = Buffer.concat([PNG, Buffer.from('contenido')]);

  const res = await request('/users/me/photo', {
    method: 'PUT',
    role: 'supervisor',
    body: JSON.stringify({ mime_type: 'image/png', data_base64: data.toString('base64') }),
  });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { photo_updated_at: '2026-11-20T12:00:00.000Z' });
  const insert = calls.find(({ sql }) => /INSERT INTO public\.user_photos/.test(sql));
  assert.deepEqual(insert.params, [USER_ID, 'image/png', data.length, data]);
});

// --- GET y DELETE /users/me/photo ---

test('CF-B6 (HTTP): GET /users/me/photo devuelve los bytes con su Content-Type, nosniff y Cache-Control', async (t) => {
  const data = Buffer.concat([PNG, Buffer.from('contenido')]);
  useDatabase(t, photoQueries({ photo: { mime_type: 'image/png', data } }));

  const res = await request('/users/me/photo', { role: 'crew' });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('cache-control'), 'private, no-cache');
  assert.equal(res.headers.get('content-disposition'), null);
  assert.deepEqual(res.bytes, data);
});

test('CF-B6 (HTTP): GET /users/me/photo sin foto responde 404 con { error }', async (t) => {
  t.mock.method(console, 'error', () => {});
  useDatabase(t, photoQueries());

  const res = await request('/users/me/photo', { role: 'crew' });

  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: 'No tienes foto de perfil.' });
});

for (const method of ['GET', 'DELETE']) {
  test(`CF-B6 (HTTP): ${method} /users/me/photo con la cuenta desactivada responde 401 sin tocar la foto`, async (t) => {
    t.mock.method(console, 'error', () => {});
    const calls = useDatabase(
      t,
      photoQueries({ isActive: false, photo: { mime_type: 'image/png', data: PNG } })
    );

    const res = await request('/users/me/photo', { method, role: 'crew' });

    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: 'La sesión ya no es válida.' });
    assert.ok(!calls.some(({ sql }) => /user_photos\s+WHERE user_id/.test(sql)));
  });
}

test('CF-B6 (HTTP): GET /users/me/photo sin sesión responde 401', async (t) => {
  useDatabase(t);

  const res = await request('/users/me/photo');

  assert.equal(res.status, 401);
});

test('CF-B6 (HTTP): DELETE /users/me/photo borra la foto y responde 204', async (t) => {
  const calls = useDatabase(t, photoQueries({ photo: { mime_type: 'image/png', data: PNG } }));

  const res = await request('/users/me/photo', { method: 'DELETE', role: 'super_admin' });

  assert.equal(res.status, 204);
  const deletion = calls.find(({ sql }) => /DELETE FROM public\.user_photos/.test(sql));
  assert.ok(deletion);
  assert.deepEqual(deletion.params, [USER_ID]);
});

// --- CF-B7: POST /users y PATCH /users/:id con los datos laborales del supervisor ---

const TARGET_ID = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
const NOT_SUPERVISOR_MESSAGE = 'Los datos laborales solo aplican a supervisores.';
const DUPLICATE_CODE_MESSAGE = 'Ya existe un supervisor con ese código de empleado.';

function duplicateEmployeeCode() {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint: 'users_employee_code_unique',
  });
}

function newSupervisorBody(overrides = {}) {
  return JSON.stringify({
    name: 'Laura Gómez',
    email: 'laura@aircrew.test',
    password: 'c'.repeat(12),
    role: 'supervisor',
    ...overrides,
  });
}

// PATCH /users/:id: primero busca la cuenta (findById) y después la actualiza.
function updateQueries(targetRole, { onUpdate } = {}) {
  const target = {
    id: TARGET_ID,
    name: 'Laura Gómez',
    email: 'laura@aircrew.test',
    role: targetRole,
    is_active: true,
    created_at: new Date('2026-01-10T15:00:00Z'),
    pending_activation: false,
  };
  return async (sql) => {
    if (sql.includes('UPDATE public.users')) {
      if (onUpdate) return onUpdate();
      return { rows: [target] };
    }
    if (sql.includes('FROM public.users')) return { rows: [target] };
    throw new Error(`Consulta inesperada en el test: ${sql}`);
  };
}

test('CF-B7 (HTTP): POST /users crea un supervisor con sus datos laborales normalizados', async (t) => {
  const calls = useDatabase(t, async (sql, params) => ({
    rows: [{ id: TARGET_ID, name: params[0], email: params[1], role: params[3], is_active: true }],
  }));

  const res = await request('/users', {
    method: 'POST',
    role: 'super_admin',
    body: newSupervisorBody({ employee_code: 'sup-001', base: 'atl', shift: 'afternoon' }),
  });

  assert.equal(res.status, 201);
  const insert = calls.find(({ sql }) => sql.includes('INSERT INTO public.users'));
  assert.deepEqual(insert.params.slice(4), ['SUP-001', 'ATL', 'afternoon', 'available']);
});

test('CF-B7 (HTTP): POST /users de un super_admin con datos laborales responde 400 sin consultar la base', async (t) => {
  t.mock.method(console, 'error', () => {});
  useDatabase(t);

  const res = await request('/users', {
    method: 'POST',
    role: 'super_admin',
    body: newSupervisorBody({ role: 'super_admin', base: 'ATL' }),
  });

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: NOT_SUPERVISOR_MESSAGE });
});

test('CF-B7 (HTTP): POST /users con un turno inválido responde 400 sin consultar la base', async (t) => {
  t.mock.method(console, 'error', () => {});
  useDatabase(t);

  const res = await request('/users', {
    method: 'POST',
    role: 'super_admin',
    body: newSupervisorBody({ shift: 'evening' }),
  });

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: 'shift debe ser uno de: morning, afternoon, night.' });
});

test('CF-B7 (HTTP): POST /users con un código de empleado repetido responde 409', async (t) => {
  t.mock.method(console, 'error', () => {});
  useDatabase(t, async () => {
    throw duplicateEmployeeCode();
  });

  const res = await request('/users', {
    method: 'POST',
    role: 'super_admin',
    body: newSupervisorBody({ employee_code: 'SUP-001' }),
  });

  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { error: DUPLICATE_CODE_MESSAGE });
});

test('CF-B7 (HTTP): PATCH /users/:id guarda los datos laborales de un supervisor', async (t) => {
  const calls = useDatabase(t, updateQueries('supervisor'));

  const res = await request(`/users/${TARGET_ID}`, {
    method: 'PATCH',
    role: 'super_admin',
    body: JSON.stringify({ base: 'msp', shift: null, operational_status: 'leave' }),
  });

  assert.equal(res.status, 200);
  const update = calls.find(({ sql }) => sql.includes('UPDATE public.users'));
  // ¿código?, código, ¿base?, base, ¿turno?, turno, ¿estado?, estado
  assert.deepEqual(update.params.slice(5), [false, null, true, 'MSP', true, null, true, 'leave']);
});

for (const role of ['crew', 'super_admin']) {
  test(`CF-B7 (HTTP): PATCH /users/:id con datos laborales de un ${role} responde 400 sin actualizar`, async (t) => {
    t.mock.method(console, 'error', () => {});
    const calls = useDatabase(t, updateQueries(role));

    const res = await request(`/users/${TARGET_ID}`, {
      method: 'PATCH',
      role: 'super_admin',
      body: JSON.stringify({ employee_code: 'SUP-001' }),
    });

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: NOT_SUPERVISOR_MESSAGE });
    assert.ok(!calls.some(({ sql }) => sql.includes('UPDATE public.users')));
  });
}

test('CF-B7 (HTTP): PATCH /users/:id con un código de empleado repetido responde 409', async (t) => {
  t.mock.method(console, 'error', () => {});
  useDatabase(
    t,
    updateQueries('supervisor', {
      onUpdate: () => {
        throw duplicateEmployeeCode();
      },
    })
  );

  const res = await request(`/users/${TARGET_ID}`, {
    method: 'PATCH',
    role: 'super_admin',
    body: JSON.stringify({ employee_code: 'SUP-001' }),
  });

  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { error: DUPLICATE_CODE_MESSAGE });
});

test('M4 (HTTP): PATCH /users/:id responde 409 si el usuario cambió de rol antes de guardar sus datos laborales', async (t) => {
  t.mock.method(console, 'error', () => {});
  useDatabase(
    t,
    updateQueries('supervisor', {
      onUpdate: () => {
        throw Object.assign(new Error('new row for relation "users" violates check constraint'), {
          code: '23514',
          constraint: 'users_employment_supervisor_check',
        });
      },
    })
  );

  const res = await request(`/users/${TARGET_ID}`, {
    method: 'PATCH',
    role: 'super_admin',
    body: JSON.stringify({ shift: 'night' }),
  });

  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { error: 'El usuario cambió de rol; vuelve a intentarlo.' });
});

test('M6 (HTTP): un supervisor que edita sus propios datos laborales por PATCH /users/:id recibe 403 sin consultar la base', async (t) => {
  useDatabase(t);

  const res = await request(`/users/${USER_ID}`, {
    method: 'PATCH',
    role: 'supervisor',
    body: JSON.stringify({ employee_code: 'SUP-001', operational_status: 'on_duty' }),
  });

  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { error: 'No tienes permisos para esta acción.' });
});
