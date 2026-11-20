const { test } = require('node:test');
const assert = require('node:assert/strict');

const SESSION_MESSAGE = 'La sesión ya no es válida.';
const EMPTY_MESSAGE = 'Envía al menos uno de: phone, residence, notifications.';
const PHONE_MESSAGE = 'El celular debe tener de 7 a 15 dígitos y puede empezar con +.';
// La residencia solo admite ciudades del catálogo (antes era texto libre de hasta 100 caracteres).
const CITY_MESSAGE = 'Elige una ciudad de Estados Unidos de la lista.';
const NOTIFICATION_KEY_MESSAGE =
  'Hay una preferencia de notificaciones que no corresponde a tu rol.';
const NOTIFICATION_VALUE_MESSAGE =
  'Las preferencias de notificaciones deben ser un objeto con valores true o false.';
const PHOTO_REQUIRED_MESSAGE = 'Se requieren mime_type y data_base64.';
const PHOTO_TYPE_MESSAGE = 'La foto debe ser PNG, JPEG o WEBP.';
const PHOTO_BASE64_MESSAGE = 'El contenido de la foto no está en base64.';
const PHOTO_SIZE_MESSAGE = 'La foto no puede pesar más de 2 MB.';
const PHOTO_SIGNATURE_MESSAGE = 'El archivo no coincide con el tipo de foto indicado.';
const PHOTO_NOT_FOUND_MESSAGE = 'No tienes foto de perfil.';

const USER_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const CREATED_AT = new Date('2026-01-10T15:00:00Z');
const CHANGED_AT = new Date('2026-11-01T10:00:00Z');
const PHOTO_AT = new Date('2026-11-20T12:00:00Z');
const MB = 1024 * 1024;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x10, 0, 0, 0]),
  Buffer.from('WEBP'),
]);

// Fila de la base como la devuelve el repositorio: con las columnas notify_*.
function rowFor(role, overrides = {}) {
  return {
    id: USER_ID,
    name: 'Ana Pérez',
    email: 'ana@aircrew.test',
    role,
    is_active: true,
    created_at: CREATED_AT,
    phone: '+573001234567',
    residence: 'Bogotá',
    password_changed_at: CHANGED_AT,
    photo_updated_at: null,
    notify_absence_reported: true,
    notify_absence_covered: false,
    notify_replacement_assigned: true,
    employee_code: null,
    base: null,
    shift: null,
    operational_status: null,
    ...overrides,
  };
}

// Supervisor sin datos laborales asignados (o crew y super_admin, que no los usan).
const UNASSIGNED_EMPLOYMENT = {
  employee_code: null,
  base: null,
  shift: null,
  operational_status: null,
};

const SUPERVISOR_EMPLOYMENT = {
  employee_code: 'SUP-001',
  base: 'ATL',
  shift: 'morning',
  operational_status: 'on_duty',
};

const NOTIFICATION_COLUMNS = {
  absence_reported: 'notify_absence_reported',
  absence_covered: 'notify_absence_covered',
  replacement_assigned: 'notify_replacement_assigned',
};

// Repositorio en memoria: una cuenta y su foto, sin PostgreSQL.
function createFakeRepository(row) {
  const state = { row: row && { ...row }, photo: null };
  const calls = [];

  return {
    state,
    calls,
    async findProfileById(id) {
      calls.push('findProfileById');
      return state.row && state.row.id === id
        ? { ...state.row, photo_updated_at: state.photo && state.photo.updated_at }
        : null;
    },
    async updateProfile(id, changes) {
      calls.push(['updateProfile', changes]);
      if (!state.row || state.row.id !== id || !state.row.is_active) return null;
      if ('phone' in changes) state.row.phone = changes.phone;
      if ('residence' in changes) state.row.residence = changes.residence;
      for (const [key, value] of Object.entries(changes.notifications || {})) {
        state.row[NOTIFICATION_COLUMNS[key]] = value;
      }
      return { ...state.row, photo_updated_at: state.photo && state.photo.updated_at };
    },
    async savePhoto(id, photo) {
      calls.push(['savePhoto', photo]);
      if (!state.row || state.row.id !== id || !state.row.is_active) return null;
      state.photo = { ...photo, updated_at: PHOTO_AT };
      return PHOTO_AT;
    },
    async findPhoto(id) {
      calls.push('findPhoto');
      return state.photo && state.row.id === id
        ? { mime_type: state.photo.mimeType, data: state.photo.data }
        : null;
    },
    async deletePhoto(id) {
      calls.push('deletePhoto');
      const existed = Boolean(state.photo) && state.row.id === id;
      state.photo = null;
      return existed;
    },
  };
}

// El require va aquí para que, si el módulo falta, cada test falle por su cuenta.
function setup(role = 'crew', row = rowFor(role)) {
  const createManageProfile = require('../src/application/use-cases/manageProfile');
  const userRepository = createFakeRepository(row);
  return {
    userRepository,
    requester: { id: USER_ID, role },
    profile: createManageProfile(userRepository),
  };
}

function rejectsWith(status, message) {
  return (error) => {
    assert.equal(error.status, status);
    assert.equal(error.message, message);
    return true;
  };
}

function expectedProfile(role, notifications, overrides = {}) {
  return {
    id: USER_ID,
    name: 'Ana Pérez',
    email: 'ana@aircrew.test',
    role,
    is_active: true,
    created_at: CREATED_AT,
    phone: '+573001234567',
    residence: 'Bogotá',
    password_changed_at: CHANGED_AT,
    photo_updated_at: null,
    notifications,
    employment: role === 'supervisor' ? UNASSIGNED_EMPLOYMENT : null,
    ...overrides,
  };
}

function base64(...parts) {
  return Buffer.concat(parts).toString('base64');
}

// --- GET /users/me ---

test('CF-B1: el perfil de un tripulante trae los campos del contrato y notifications { replacement_assigned }', async () => {
  const { profile, requester } = setup('crew');

  const result = await profile.getMyProfile(requester);

  assert.deepEqual(result, expectedProfile('crew', { replacement_assigned: true }));
});

test('CF-B1: el perfil de un supervisor trae notifications { absence_reported, absence_covered }', async () => {
  const { profile, requester } = setup('supervisor');

  const result = await profile.getMyProfile(requester);

  assert.deepEqual(
    result,
    expectedProfile('supervisor', { absence_reported: true, absence_covered: false })
  );
});

// Ampliación B: el super_admin no tiene preferencias de notificaciones.
test('CF-B9: el perfil de un super_admin trae notifications null aunque la fila tenga las columnas notify_*', async () => {
  const { profile, requester } = setup('super_admin');

  const result = await profile.getMyProfile(requester);

  assert.deepEqual(result, expectedProfile('super_admin', null));
});

test('CF-B7: el perfil de un supervisor trae employment con su código, base, turno y estado', async () => {
  const { profile, requester } = setup('supervisor', rowFor('supervisor', SUPERVISOR_EMPLOYMENT));

  const result = await profile.getMyProfile(requester);

  assert.deepEqual(result.employment, SUPERVISOR_EMPLOYMENT);
  assert.equal(result.employee_code, undefined);
  assert.equal(result.base, undefined);
});

for (const role of ['crew', 'super_admin']) {
  test(`CF-B7: el perfil de un ${role} trae employment null aunque la fila tenga datos laborales`, async () => {
    const { profile, requester } = setup(role, rowFor(role, SUPERVISOR_EMPLOYMENT));

    const result = await profile.getMyProfile(requester);

    assert.equal(result.employment, null);
  });
}

test('CF-B7: PATCH /users/me de un supervisor responde con employment y no cambia los datos laborales', async () => {
  const { profile, requester, userRepository } = setup(
    'supervisor',
    rowFor('supervisor', SUPERVISOR_EMPLOYMENT)
  );

  const result = await profile.updateMyProfile(requester, {
    residence: 'Boston, MA',
    employee_code: 'SUP-999',
    base: 'SEA',
  });

  assert.deepEqual(userRepository.calls[0], ['updateProfile', { residence: 'Boston, MA' }]);
  assert.deepEqual(result.employment, SUPERVISOR_EMPLOYMENT);
});

test('CF-B1: el perfil no incluye columnas internas ni datos de la foto, solo photo_updated_at', async () => {
  const { profile, requester, userRepository } = setup(
    'crew',
    rowFor('crew', { password_hash: 'hash-anterior', pending_activation: false })
  );
  userRepository.state.photo = { mimeType: 'image/png', data: PNG, updated_at: PHOTO_AT };

  const result = await profile.getMyProfile(requester);

  assert.deepEqual(
    result,
    expectedProfile('crew', { replacement_assigned: true }, { photo_updated_at: PHOTO_AT })
  );
});

for (const [label, row] of [
  ['una cuenta desactivada', rowFor('crew', { is_active: false })],
  ['una cuenta que ya no existe', null],
]) {
  test(`CF-B1: con ${label} responde 401`, async () => {
    const { profile, requester } = setup('crew', row);

    await assert.rejects(profile.getMyProfile(requester), rejectsWith(401, SESSION_MESSAGE));
  });
}

test('CF-B1: con un id de sesión que no es UUID responde 401 sin consultar el repositorio', async () => {
  const { profile, userRepository } = setup('crew');

  await assert.rejects(
    profile.getMyProfile({ id: 'no-es-uuid', role: 'crew' }),
    rejectsWith(401, SESSION_MESSAGE)
  );
  assert.deepEqual(userRepository.calls, []);
});

// --- PATCH /users/me ---

test('CF-B2: guarda el celular sin espacios y la residencia sin espacios en los extremos', async () => {
  const { profile, requester, userRepository } = setup('crew');

  const result = await profile.updateMyProfile(requester, {
    phone: ' +57 310 555 0000 ',
    residence: '  Atlanta, GA  ',
  });

  assert.deepEqual(userRepository.calls[0], [
    'updateProfile',
    { phone: '+573105550000', residence: 'Atlanta, GA' },
  ]);
  assert.deepEqual(
    result,
    expectedProfile(
      'crew',
      { replacement_assigned: true },
      { phone: '+573105550000', residence: 'Atlanta, GA' }
    )
  );
});

for (const [label, value] of [
  ['vacíos', ''],
  ['con solo espacios', '   '],
  ['null', null],
]) {
  test(`CF-B2: guarda el celular y la residencia ${label} como null`, async () => {
    const { profile, requester, userRepository } = setup('crew');

    const result = await profile.updateMyProfile(requester, { phone: value, residence: value });

    assert.deepEqual(userRepository.calls[0], [
      'updateProfile',
      { phone: null, residence: null },
    ]);
    assert.equal(result.phone, null);
    assert.equal(result.residence, null);
  });
}

test('CF-B2: solo cambia los campos enviados', async () => {
  const { profile, requester, userRepository } = setup('crew');

  const result = await profile.updateMyProfile(requester, { residence: 'Seattle, WA' });

  assert.deepEqual(userRepository.calls[0], ['updateProfile', { residence: 'Seattle, WA' }]);
  assert.equal(result.phone, '+573001234567');
  assert.equal(result.residence, 'Seattle, WA');
});

test('CF-B8: guarda la ciudad con la forma del catálogo aunque llegue con otras mayúsculas', async () => {
  const { profile, requester, userRepository } = setup('supervisor');

  const result = await profile.updateMyProfile(requester, { residence: 'salt lake city, ut' });

  assert.deepEqual(userRepository.calls[0], ['updateProfile', { residence: 'Salt Lake City, UT' }]);
  assert.equal(result.residence, 'Salt Lake City, UT');
});

test('CF-B8: una residencia guardada que no está en el catálogo se devuelve tal cual', async () => {
  const { profile, requester } = setup('crew', rowFor('crew', { residence: 'Medellín' }));

  const result = await profile.getMyProfile(requester);

  assert.equal(result.residence, 'Medellín');
});

test('CF-B2: acepta un celular de 7 dígitos y otro de 15 con +', async () => {
  for (const phone of ['1234567', '+123456789012345']) {
    const { profile, requester } = setup('crew');

    const result = await profile.updateMyProfile(requester, { phone });

    assert.equal(result.phone, phone);
  }
});

test('CF-B2: un tripulante guarda su preferencia replacement_assigned', async () => {
  const { profile, requester } = setup('crew');

  const result = await profile.updateMyProfile(requester, {
    notifications: { replacement_assigned: false },
  });

  assert.deepEqual(result.notifications, { replacement_assigned: false });
});

test('CF-B2: un supervisor guarda sus preferencias absence_reported y absence_covered', async () => {
  const { profile, requester } = setup('supervisor');

  const result = await profile.updateMyProfile(requester, {
    notifications: { absence_reported: false, absence_covered: true },
  });

  assert.deepEqual(result.notifications, { absence_reported: false, absence_covered: true });
});

for (const [label, role, input, message] of [
  ['con un celular con letras', 'crew', { phone: '300abc4567' }, PHONE_MESSAGE],
  ['con un celular de 6 dígitos', 'crew', { phone: '123456' }, PHONE_MESSAGE],
  ['con un celular de 16 dígitos', 'crew', { phone: '1234567890123456' }, PHONE_MESSAGE],
  ['con un celular con dos +', 'crew', { phone: '++573001234567' }, PHONE_MESSAGE],
  ['con un + en medio del celular', 'crew', { phone: '57+3001234567' }, PHONE_MESSAGE],
  ['con un celular que no es texto', 'crew', { phone: 3001234567 }, PHONE_MESSAGE],
  ['con una residencia de 101 caracteres', 'crew', { residence: 'a'.repeat(101) }, CITY_MESSAGE],
  ['con una residencia que no es texto', 'crew', { residence: 42 }, CITY_MESSAGE],
  ['con un carácter nulo en la residencia', 'crew', { residence: 'Bogo\u0000tá' }, CITY_MESSAGE],
  ['con un carácter de control en la residencia', 'crew', { residence: 'Bogo\u007Ftá' }, CITY_MESSAGE],
  ['con una ciudad que no es de EE. UU.', 'crew', { residence: 'Bogotá' }, CITY_MESSAGE],
  ['con una ciudad del catálogo sin su estado', 'crew', { residence: 'Atlanta' }, CITY_MESSAGE],
  ['con una ciudad con otro estado', 'crew', { residence: 'Atlanta, TX' }, CITY_MESSAGE],
  [
    'con absence_reported de un tripulante',
    'crew',
    { notifications: { absence_reported: true } },
    NOTIFICATION_KEY_MESSAGE,
  ],
  [
    'con replacement_assigned de un supervisor',
    'supervisor',
    { notifications: { replacement_assigned: true } },
    NOTIFICATION_KEY_MESSAGE,
  ],
  [
    'con replacement_assigned de un super_admin',
    'super_admin',
    { notifications: { replacement_assigned: true } },
    NOTIFICATION_KEY_MESSAGE,
  ],
  [
    'con una preferencia que no existe',
    'supervisor',
    { notifications: { constructor: true } },
    NOTIFICATION_KEY_MESSAGE,
  ],
  [
    'con una preferencia que no es booleana',
    'crew',
    { notifications: { replacement_assigned: 'si' } },
    NOTIFICATION_VALUE_MESSAGE,
  ],
  ['con notifications que no es un objeto', 'crew', { notifications: [true] }, NOTIFICATION_VALUE_MESSAGE],
  ['con notifications null', 'crew', { notifications: null }, NOTIFICATION_VALUE_MESSAGE],
  ['con un body vacío', 'crew', {}, EMPTY_MESSAGE],
  ['con notifications vacío', 'crew', { notifications: {} }, EMPTY_MESSAGE],
  ['sin body', 'crew', undefined, EMPTY_MESSAGE],
]) {
  test(`CF-B2: ${label} responde 400 sin guardar nada`, async () => {
    const { profile, requester, userRepository } = setup(role);

    await assert.rejects(profile.updateMyProfile(requester, input), rejectsWith(400, message));
    assert.deepEqual(userRepository.calls, []);
  });
}

// Ampliación B: cualquier notifications de un super_admin responde lo mismo, aunque sea vacío o null.
for (const [label, input] of [
  ['absence_reported y absence_covered', { notifications: { absence_reported: true, absence_covered: false } }],
  ['notifications vacío junto a un celular válido', { phone: '+573001234567', notifications: {} }],
  ['notifications null', { notifications: null }],
]) {
  test(`CF-B9: un super_admin con ${label} responde 400 sin guardar nada`, async () => {
    const { profile, requester, userRepository } = setup('super_admin');

    await assert.rejects(
      profile.updateMyProfile(requester, input),
      rejectsWith(400, NOTIFICATION_KEY_MESSAGE)
    );
    assert.deepEqual(userRepository.calls, []);
  });
}

test('CF-B9: un super_admin sigue guardando su celular y su residencia', async () => {
  const { profile, requester, userRepository } = setup('super_admin');

  const result = await profile.updateMyProfile(requester, { residence: 'Seattle, WA' });

  assert.deepEqual(userRepository.calls[0], ['updateProfile', { residence: 'Seattle, WA' }]);
  assert.equal(result.residence, 'Seattle, WA');
  assert.equal(result.notifications, null);
});

test('CF-B2: con una cuenta desactivada responde 401', async () => {
  const { profile, requester } = setup('crew', rowFor('crew', { is_active: false }));

  await assert.rejects(
    profile.updateMyProfile(requester, { residence: 'Seattle, WA' }),
    rejectsWith(401, SESSION_MESSAGE)
  );
});

// --- PUT /users/me/photo ---

for (const [mimeType, bytes] of [
  ['image/png', PNG],
  ['image/jpeg', JPEG],
  ['image/webp', WEBP],
]) {
  test(`CF-B5: guarda una foto ${mimeType} y responde con photo_updated_at`, async () => {
    const { profile, requester, userRepository } = setup('crew');
    const data = Buffer.concat([bytes, Buffer.from('contenido')]);

    const result = await profile.savePhoto(requester, {
      mime_type: mimeType,
      data_base64: data.toString('base64'),
    });

    assert.deepEqual(result, { photo_updated_at: PHOTO_AT });
    assert.deepEqual(userRepository.calls[0], [
      'savePhoto',
      { mimeType, sizeBytes: data.length, data },
    ]);
  });
}

test('CF-B5: acepta una foto de exactamente 2 MB', async () => {
  const { profile, requester } = setup('crew');
  const data = Buffer.concat([PNG, Buffer.alloc(2 * MB - PNG.length, 1)]);

  const result = await profile.savePhoto(requester, {
    mime_type: 'image/png',
    data_base64: data.toString('base64'),
  });

  assert.deepEqual(result, { photo_updated_at: PHOTO_AT });
});

for (const [label, input, message] of [
  ['con otro tipo de archivo', { mime_type: 'image/gif', data_base64: base64(PNG) }, PHOTO_TYPE_MESSAGE],
  ['con un tipo heredado de Object', { mime_type: 'constructor', data_base64: base64(PNG) }, PHOTO_TYPE_MESSAGE],
  [
    'con más de 2 MB',
    { mime_type: 'image/png', data_base64: base64(PNG, Buffer.alloc(2 * MB - PNG.length + 1, 1)) },
    PHOTO_SIZE_MESSAGE,
  ],
  ['con un PNG que en realidad es un JPEG', { mime_type: 'image/png', data_base64: base64(JPEG, PNG) }, PHOTO_SIGNATURE_MESSAGE],
  [
    'con un WEBP sin la marca WEBP',
    { mime_type: 'image/webp', data_base64: base64(Buffer.from('RIFF'), Buffer.alloc(8, 0)) },
    PHOTO_SIGNATURE_MESSAGE,
  ],
  ['con un WEBP de 4 bytes', { mime_type: 'image/webp', data_base64: base64(Buffer.from('RIFF')) }, PHOTO_SIGNATURE_MESSAGE],
  [
    'con el prefijo data:',
    { mime_type: 'image/png', data_base64: `data:image/png;base64,${base64(PNG)}` },
    PHOTO_BASE64_MESSAGE,
  ],
  ['con un contenido que no es base64', { mime_type: 'image/png', data_base64: 'no es base64!' }, PHOTO_BASE64_MESSAGE],
  ['con un contenido vacío', { mime_type: 'image/png', data_base64: '' }, PHOTO_REQUIRED_MESSAGE],
  ['sin tipo', { data_base64: base64(PNG) }, PHOTO_REQUIRED_MESSAGE],
  ['sin body', undefined, PHOTO_REQUIRED_MESSAGE],
]) {
  test(`CF-B5: ${label} responde 400 sin guardar nada`, async () => {
    const { profile, requester, userRepository } = setup('crew');

    await assert.rejects(profile.savePhoto(requester, input), rejectsWith(400, message));
    assert.deepEqual(userRepository.calls, []);
  });
}

test('CF-B5: con una cuenta desactivada responde 401', async () => {
  const { profile, requester } = setup('crew', rowFor('crew', { is_active: false }));

  await assert.rejects(
    profile.savePhoto(requester, { mime_type: 'image/png', data_base64: base64(PNG) }),
    rejectsWith(401, SESSION_MESSAGE)
  );
});

// --- GET y DELETE /users/me/photo ---

test('CF-B6: devuelve el tipo y los bytes de la foto guardada', async () => {
  const { profile, requester } = setup('crew');
  const data = Buffer.concat([PNG, Buffer.from('contenido')]);
  await profile.savePhoto(requester, { mime_type: 'image/png', data_base64: data.toString('base64') });

  const result = await profile.getPhoto(requester);

  assert.deepEqual(result, { mime_type: 'image/png', data });
});

test('CF-B6: sin foto responde 404', async () => {
  const { profile, requester } = setup('crew');

  await assert.rejects(profile.getPhoto(requester), rejectsWith(404, PHOTO_NOT_FOUND_MESSAGE));
});

test('CF-B6: borrar la foto la quita del perfil y después responde 404', async () => {
  const { profile, requester } = setup('crew');
  await profile.savePhoto(requester, { mime_type: 'image/png', data_base64: base64(PNG) });

  await profile.deletePhoto(requester);

  assert.equal((await profile.getMyProfile(requester)).photo_updated_at, null);
  await assert.rejects(profile.getPhoto(requester), rejectsWith(404, PHOTO_NOT_FOUND_MESSAGE));
});

test('CF-B6: borrar sin foto no falla', async () => {
  const { profile, requester } = setup('crew');

  await profile.deletePhoto(requester);
});

for (const [label, row] of [
  ['una cuenta desactivada', rowFor('crew', { is_active: false })],
  ['una cuenta que ya no existe', null],
]) {
  test(`CF-B6: con ${label}, ver la foto responde 401`, async () => {
    const { profile, requester, userRepository } = setup('crew', row);
    userRepository.state.photo = { mimeType: 'image/png', data: PNG, updated_at: PHOTO_AT };

    await assert.rejects(profile.getPhoto(requester), rejectsWith(401, SESSION_MESSAGE));
    assert.ok(!userRepository.calls.includes('findPhoto'));
  });

  test(`CF-B6: con ${label}, borrar la foto responde 401 sin borrarla`, async () => {
    const { profile, requester, userRepository } = setup('crew', row);
    userRepository.state.photo = { mimeType: 'image/png', data: PNG, updated_at: PHOTO_AT };

    await assert.rejects(profile.deletePhoto(requester), rejectsWith(401, SESSION_MESSAGE));
    assert.ok(!userRepository.calls.includes('deletePhoto'));
    assert.notEqual(userRepository.state.photo, null);
  });
}
