const { test } = require('node:test');
const assert = require('node:assert/strict');

// Pantalla Usuarios del super_admin: todo entra por Admin. Admin crea la cuenta
// de cualquier rol y, si es tripulante, le pide a Crew su perfil.

const { createUser: buildUser } = require('../src/domain/entities/user');
const { createCreateUser } = require('../src/application/use-cases/createUser');
const createManageUsers = require('../src/application/use-cases/manageUsers');
const createGetUserById = require('../src/application/use-cases/getUserById');

const ADMIN_ID = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const CREW_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const SUPERVISOR_ID = '7a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const REQUESTER = { id: ADMIN_ID, role: 'super_admin' };

function rejectsWith(status, message) {
  return (error) => {
    assert.equal(error.status, status);
    if (message) assert.equal(error.message, message);
    return true;
  };
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function crewInput(overrides = {}) {
  return {
    name: 'Diego Salcedo',
    email: 'D.Salcedo@aircrew.test',
    role: 'crew',
    phone: '+1 404 555 0142',
    employee_code: 'ac-1108',
    position: 'Comandante',
    base: 'atl',
    ...overrides,
  };
}

// ------------------------------------------------------------- dominio

test('el alta no recibe contraseña: cada usuario la crea al activar su cuenta', () => {
  assert.throws(
    () => buildUser({ name: 'Ana', email: 'ana@aircrew.test', role: 'supervisor', password: 'c'.repeat(12) }),
    rejectsWith(400, 'No envíes password: cada usuario crea su contraseña al activar su cuenta.')
  );
  assert.throws(() => buildUser({ email: 'ana@aircrew.test', role: 'supervisor' }), rejectsWith(400, 'Se requieren name, email y role.'));
  assert.throws(
    () => buildUser({ name: 'Ana', email: 'ana@aircrew.test', role: 'pilot' }),
    rejectsWith(400, 'role debe ser uno de: crew, supervisor, super_admin.')
  );
});

test('un tripulante trae su perfil de Crew normalizado y su celular', () => {
  const user = buildUser(crewInput());

  assert.equal(user.email, 'd.salcedo@aircrew.test');
  assert.equal(user.phone, '+14045550142');
  assert.equal(user.employment, null);
  assert.deepEqual(user.crewProfile, { employee_code: 'AC-1108', position: 'Comandante', base: 'ATL' });
});

test('un tripulante necesita código y cargo, y su base es un hub', () => {
  assert.throws(() => buildUser(crewInput({ employee_code: undefined })), rejectsWith(400, 'Un tripulante necesita employee_code.'));
  assert.throws(() => buildUser(crewInput({ position: ' ' })), rejectsWith(400, 'Un tripulante necesita position (su cargo).'));
  assert.throws(() => buildUser(crewInput({ base: 'MEX' })), /base debe ser uno de/);
  assert.throws(() => buildUser(crewInput({ shift: 'night' })), rejectsWith(400, 'Los datos laborales solo aplican a supervisores.'));
});

test('supervisor y super_admin no tienen cargo ni estado de tripulante', () => {
  for (const role of ['supervisor', 'super_admin']) {
    for (const field of ['position', 'status']) {
      assert.throws(
        () => buildUser({ name: 'Ana', email: 'ana@aircrew.test', role, [field]: 'x' }),
        rejectsWith(400, 'position y status solo aplican a tripulantes.')
      );
    }
  }
});

test('un super_admin y un supervisor no tienen perfil de Crew', () => {
  assert.equal(buildUser({ name: 'Ana', email: 'ana@aircrew.test', role: 'super_admin' }).crewProfile, null);
  const supervisor = buildUser({ name: 'Ana', email: 'ana@aircrew.test', role: 'supervisor' });
  assert.equal(supervisor.crewProfile, null);
  assert.equal(supervisor.employment.operationalStatus, 'available');
});

// --------------------------------------------------------------- alta

function setupCreate({ createError, crewError, sendError, deleteError } = {}) {
  const steps = [];
  const userRepository = {
    async createPendingUser(data) {
      steps.push(['account', data]);
      if (createError) throw createError;
      return {
        id: CREW_ID,
        name: data.name,
        email: data.email,
        role: data.role,
        phone: data.phone,
        is_active: false,
        pending_activation: true,
        created_at: new Date('2026-11-20T12:00:00Z'),
      };
    },
    async deletePendingUser(id) {
      steps.push(['delete-account', id]);
      if (deleteError) throw deleteError;
      return true;
    },
  };
  const crewClient = {
    async createProfile(profile) {
      steps.push(['crew-profile', profile]);
      if (crewError) throw crewError;
      return { user_id: profile.user_id, ...profile, status: 'available' };
    },
    async deleteProfile(id) {
      steps.push(['delete-crew-profile', id]);
    },
  };
  const emailClient = {
    async sendCrewInvitation(data) {
      steps.push(['email', data.email]);
      if (sendError) throw sendError;
    },
  };
  const passwordHasher = { hash: async () => 'hash-temporal' };
  return {
    steps,
    createUser: createCreateUser({ userRepository, passwordHasher, emailClient, crewClient }),
  };
}

test('alta de un tripulante: cuenta pendiente, perfil en Crew y después el correo', async () => {
  const { steps, createUser } = setupCreate();

  const result = await createUser(crewInput());

  assert.deepEqual(steps.map(([step]) => step), ['account', 'crew-profile', 'email']);
  const account = steps[0][1];
  assert.equal(account.role, 'crew');
  assert.equal(account.phone, '+14045550142');
  assert.equal(typeof account.activationTokenHash, 'string');
  assert.deepEqual(steps[1][1], { user_id: CREW_ID, employee_code: 'AC-1108', position: 'Comandante', base: 'ATL' });
  assert.equal(result.employee_code, 'AC-1108');
  assert.equal(result.position, 'Comandante');
  assert.equal(result.base, 'ATL');
  assert.equal(result.status, 'available');
  assert.equal(result.pending_activation, true);
});

test('alta de un supervisor: no toca Crew', async () => {
  const { steps, createUser } = setupCreate();

  await createUser({ name: 'Laura Gómez', email: 'laura@aircrew.test', role: 'supervisor', base: 'jfk' });

  assert.deepEqual(steps.map(([step]) => step), ['account', 'email']);
  assert.equal(steps[0][1].employment.base, 'JFK');
});

test('si Crew rechaza el perfil, se borra la cuenta y no sale ningún correo', async () => {
  const crewError = httpError(409, 'Ya existe un tripulante con ese código de empleado.');
  const { steps, createUser } = setupCreate({ crewError });

  await assert.rejects(createUser(crewInput()), (error) => error === crewError);
  assert.deepEqual(steps.map(([step]) => step), ['account', 'crew-profile', 'delete-account']);
});

test('si el correo falla, se borran el perfil de Crew y la cuenta, y llega el error del correo', async () => {
  const sendError = httpError(502, 'No se pudo enviar el correo de invitación.');
  const { steps, createUser } = setupCreate({ sendError });

  await assert.rejects(createUser(crewInput()), (error) => error === sendError);
  assert.deepEqual(steps.map(([step]) => step), [
    'account',
    'crew-profile',
    'email',
    'delete-crew-profile',
    'delete-account',
  ]);
});

test('si deshacer también falla, llega el error original y queda en el log', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  const sendError = httpError(502, 'No se pudo enviar el correo de invitación.');
  const { createUser } = setupCreate({ sendError, deleteError: new Error('base caída') });

  await assert.rejects(createUser(crewInput()), (error) => error === sendError);
  assert.equal(log.mock.callCount(), 1);
});

test('si la cuenta no se crea (email repetido), no se llama a Crew ni se envía correo', async () => {
  const duplicate = httpError(409, 'Ya existe un usuario con ese email.');
  const { steps, createUser } = setupCreate({ createError: duplicate });

  await assert.rejects(createUser(crewInput()), (error) => error === duplicate);
  assert.deepEqual(steps.map(([step]) => step), ['account']);
});

// ------------------------------------------------------ lista e indicadores

const USERS = [
  { id: ADMIN_ID, name: 'Mateo Morales', email: 'm.morales@aircrew.test', role: 'super_admin', is_active: true, employee_code: null, base: null },
  { id: SUPERVISOR_ID, name: 'Camila Restrepo', email: 'c.restrepo@aircrew.test', role: 'supervisor', is_active: true, employee_code: 'SUP-001', base: 'JFK', shift: 'morning', operational_status: 'on_duty', phone: '+12125550177' },
  { id: CREW_ID, name: 'Valeria Ortiz', email: 'v.ortiz@aircrew.test', role: 'crew', is_active: true, employee_code: null, base: null },
];
const CREW_PROFILES = [
  { user_id: CREW_ID, employee_code: 'AC-5520', position: 'Auxiliar de Vuelo', base: 'SEA', status: 'in_flight', is_active: true },
];

function setupManage({ users = USERS, profiles = CREW_PROFILES, crewDown = false, updateError, crewUpdateError } = {}) {
  const calls = [];
  const userRepository = {
    async findUsers(filters) {
      calls.push(['findUsers', filters]);
      return users.filter((user) => !filters.role || user.role === filters.role);
    },
    async findById(id) {
      return users.find((user) => user.id === id) || null;
    },
    async findUserDetailById(id) {
      calls.push(['findUserDetailById', id]);
      return users.find((user) => user.id === id) || null;
    },
    async updateUser(id, changes) {
      calls.push(['updateUser', id, changes]);
      if (updateError) throw updateError;
      return { ...users.find((user) => user.id === id), ...changes };
    },
  };
  const crewClient = {
    async listProfiles() {
      if (crewDown) throw httpError(502, 'No se pudo comunicar con el servicio de tripulación.');
      return profiles;
    },
    async getProfile(id) {
      if (crewDown) throw httpError(502, 'No se pudo comunicar con el servicio de tripulación.');
      return profiles.find((profile) => profile.user_id === id);
    },
    async updateProfile(id, patch) {
      calls.push(['crew.updateProfile', id, patch]);
      if (crewUpdateError && calls.filter(([name]) => name === 'crew.updateProfile').length === 1) {
        throw crewUpdateError;
      }
      return { ...profiles.find((profile) => profile.user_id === id), ...patch };
    },
  };
  return { calls, manageUsers: createManageUsers(userRepository, { crewClient }), userRepository, crewClient };
}

test('la lista une la cuenta con el perfil de Crew o los datos laborales', async () => {
  const { manageUsers } = setupManage();

  const { items, total, page, page_size: pageSize } = await manageUsers.listUsers({});

  assert.equal(total, 3);
  assert.equal(page, 1);
  assert.equal(pageSize, 10);
  const byId = Object.fromEntries(items.map((item) => [item.id, item]));
  assert.deepEqual(
    [byId[CREW_ID].employee_code, byId[CREW_ID].position, byId[CREW_ID].base, byId[CREW_ID].status, byId[CREW_ID].shift],
    ['AC-5520', 'Auxiliar de Vuelo', 'SEA', 'in_flight', null]
  );
  assert.deepEqual(
    [byId[SUPERVISOR_ID].employee_code, byId[SUPERVISOR_ID].base, byId[SUPERVISOR_ID].status, byId[SUPERVISOR_ID].shift],
    ['SUP-001', 'JFK', 'on_duty', 'morning']
  );
  assert.deepEqual(
    [byId[ADMIN_ID].employee_code, byId[ADMIN_ID].base, byId[ADMIN_ID].status, byId[ADMIN_ID].position],
    [null, null, null, null]
  );
});

test('la búsqueda encuentra por código, base o cargo de Crew, sin tildes ni mayúsculas', async () => {
  const { manageUsers } = setupManage();

  for (const search of ['ac-5520', 'sea', 'auxiliar', 'VALERIA']) {
    const { items } = await manageUsers.listUsers({ search });
    assert.deepEqual(items.map((item) => item.id), [CREW_ID], search);
  }

  const { items } = await manageUsers.listUsers({ search: 'jfk' });
  assert.deepEqual(items.map((item) => item.id), [SUPERVISOR_ID]);
});

test('el filtro de rol llega al repositorio y la página corta el resultado', async () => {
  const { calls, manageUsers } = setupManage();

  const crew = await manageUsers.listUsers({ role: 'crew' });
  assert.deepEqual(calls[0], ['findUsers', { search: null, role: 'crew' }]);
  assert.equal(crew.total, 1);

  const second = await manageUsers.listUsers({ page: '2', page_size: '2' });
  assert.equal(second.items.length, 1);
  assert.equal(second.total, 3);

  await assert.rejects(manageUsers.listUsers({ page: '0' }), rejectsWith(400));
  await assert.rejects(manageUsers.listUsers({ page_size: '101' }), rejectsWith(400));
  await assert.rejects(manageUsers.listUsers({ role: 'tripulacion' }), rejectsWith(400));
});

test('si Crew no responde, la lista sale igual sin los datos del tripulante', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { manageUsers } = setupManage({ crewDown: true });

  const { items } = await manageUsers.listUsers({});

  assert.equal(items.length, 3);
  assert.equal(items.find((item) => item.id === CREW_ID).employee_code, null);
});

test('indicadores: total, por rol, en vuelo y de guardia', async () => {
  const { manageUsers } = setupManage();

  assert.deepEqual(await manageUsers.getUserStats(), {
    total: 3,
    by_role: { crew: 1, supervisor: 1, super_admin: 1 },
    in_flight: 1,
    on_duty: 1,
    medical_fitness_percent: null,
  });
});

// -------------------------------------------------------------- edición

test('editar un tripulante: nombre en Admin y base en Crew', async () => {
  const { calls, manageUsers } = setupManage();

  const result = await manageUsers.updateUser(REQUESTER, CREW_ID, { name: ' Valeria O. ', base: 'atl' });

  assert.deepEqual(calls.find(([name]) => name === 'crew.updateProfile'), ['crew.updateProfile', CREW_ID, { base: 'ATL' }]);
  assert.deepEqual(calls.find(([name]) => name === 'updateUser'), ['updateUser', CREW_ID, { name: 'Valeria O.' }]);
  assert.equal(result.base, 'ATL');
  assert.equal(result.name, 'Valeria O.');
});

test('editar solo el perfil de Crew no actualiza la cuenta', async () => {
  const { calls, manageUsers } = setupManage();

  const result = await manageUsers.updateUser(REQUESTER, CREW_ID, { status: 'medical_leave' });

  assert.ok(!calls.some(([name]) => name === 'updateUser'));
  assert.equal(result.status, 'medical_leave');
});

test('si Crew rechaza el cambio, la cuenta no se toca', async () => {
  const crewUpdateError = httpError(409, 'Ya existe un tripulante con ese código de empleado.');
  const { calls, manageUsers } = setupManage({ crewUpdateError });

  await assert.rejects(
    manageUsers.updateUser(REQUESTER, CREW_ID, { name: 'Otra', employee_code: 'AC-1108' }),
    (error) => error === crewUpdateError
  );
  assert.ok(!calls.some(([name]) => name === 'updateUser'));
});

test('si Admin falla después de Crew, Crew vuelve a como estaba', async () => {
  const updateError = httpError(409, 'Ya existe un usuario con ese email.');
  const { calls, manageUsers } = setupManage({ updateError });

  await assert.rejects(
    manageUsers.updateUser(REQUESTER, CREW_ID, { email: 'otro@aircrew.test', base: 'atl' }),
    (error) => error === updateError
  );
  const crewCalls = calls.filter(([name]) => name === 'crew.updateProfile');
  assert.deepEqual(crewCalls, [
    ['crew.updateProfile', CREW_ID, { base: 'ATL' }],
    ['crew.updateProfile', CREW_ID, { base: 'SEA' }],
  ]);
});

test('desactivar un tripulante también lo desactiva en Crew', async () => {
  const { calls, manageUsers } = setupManage();

  await manageUsers.deactivateUser(REQUESTER, CREW_ID);

  assert.deepEqual(calls.find(([name]) => name === 'crew.updateProfile'), ['crew.updateProfile', CREW_ID, { is_active: false }]);
  assert.deepEqual(calls.find(([name]) => name === 'updateUser'), ['updateUser', CREW_ID, { isActive: false }]);
});

test('desactivar un supervisor no llama a Crew', async () => {
  const { calls, manageUsers } = setupManage();

  await manageUsers.deactivateUser(REQUESTER, SUPERVISOR_ID);

  assert.ok(!calls.some(([name]) => name === 'crew.updateProfile'));
});

test('el celular se edita para cualquier rol y se valida', async () => {
  const { calls, manageUsers } = setupManage();

  await manageUsers.updateUser(REQUESTER, SUPERVISOR_ID, { phone: '+1 212 555 0100' });
  assert.deepEqual(calls.find(([name]) => name === 'updateUser')[2], { phone: '+12125550100' });

  await assert.rejects(manageUsers.updateUser(REQUESTER, SUPERVISOR_ID, { phone: '12' }), rejectsWith(400));
});

test('un supervisor no tiene cargo de tripulante', async () => {
  const { manageUsers } = setupManage();

  await assert.rejects(
    manageUsers.updateUser(REQUESTER, SUPERVISOR_ID, { position: 'Comandante' }),
    rejectsWith(400, 'position y status solo aplican a tripulantes.')
  );
});

// ---------------------------------------------------------------- ficha

test('la ficha de un tripulante trae su perfil de Crew', async () => {
  const { userRepository, crewClient } = setupManage();
  const getUserById = createGetUserById(userRepository, { crewClient });

  const user = await getUserById(REQUESTER, CREW_ID);

  assert.equal(user.employee_code, 'AC-5520');
  assert.equal(user.position, 'Auxiliar de Vuelo');
  assert.equal('password_changed_at' in user, false);
});

test('si Crew no responde, la ficha sale sin el perfil', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { userRepository, crewClient } = setupManage({ crewDown: true });
  const getUserById = createGetUserById(userRepository, { crewClient });

  const user = await getUserById(REQUESTER, CREW_ID);

  assert.equal(user.employee_code, null);
});
