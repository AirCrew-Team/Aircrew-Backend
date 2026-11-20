const { test } = require('node:test');
const assert = require('node:assert/strict');

// Datos laborales del supervisor (Ampliación A1): los asigna un super_admin con
// POST /users y PATCH /users/:id.

const NOT_SUPERVISOR_MESSAGE = 'Los datos laborales solo aplican a supervisores.';
const EMPLOYEE_CODE_MESSAGE =
  'employee_code debe tener de 3 a 30 caracteres: letras, números o guiones.';
const BASE_MESSAGE = 'base debe ser uno de: ATL, BOS, DTW, LAX, MSP, JFK, LGA, SLC, SEA.';
const SHIFT_MESSAGE = 'shift debe ser uno de: morning, afternoon, night.';
const STATUS_MESSAGE =
  'operational_status debe ser uno de: available, on_duty, off_duty, leave.';
const EMPTY_UPDATE_MESSAGE =
  'Envía al menos uno de: name, email, role, is_active, employee_code, base, shift, operational_status.';

const ADMIN_ID = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const USER_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const PASSWORD = 'c'.repeat(12);

const EMPLOYMENT_FIELDS = ['employee_code', 'base', 'shift', 'operational_status'];
const VALID_EMPLOYMENT = {
  employee_code: 'SUP-001',
  base: 'ATL',
  shift: 'morning',
  operational_status: 'on_duty',
};

function rejectsWith(status, message) {
  return (error) => {
    assert.equal(error.status, status);
    assert.equal(error.message, message);
    return true;
  };
}

// --- POST /users ---

// El require va aquí para que, si algo falta, cada test falle por su cuenta.
function setupCreate() {
  const { createCreateUser } = require('../src/application/use-cases/createUser');
  const calls = [];
  const userRepository = {
    async create(data) {
      calls.push(data);
      return { id: USER_ID, name: data.name, email: data.email, role: data.role };
    },
  };
  const passwordHasher = { hash: async (value) => `hash:${value}` };
  return { calls, createUser: createCreateUser({ userRepository, passwordHasher }) };
}

function supervisorInput(overrides = {}) {
  return {
    name: 'Laura Gómez',
    email: 'laura@aircrew.test',
    password: PASSWORD,
    role: 'supervisor',
    ...overrides,
  };
}

test('CF-B7: crear un supervisor guarda su código, base, turno y estado normalizados', async () => {
  const { calls, createUser } = setupCreate();

  await createUser(
    supervisorInput({
      employee_code: '  sup-001 ',
      base: 'atl',
      shift: 'night',
      operational_status: 'off_duty',
    })
  );

  assert.deepEqual(calls[0].employment, {
    employeeCode: 'SUP-001',
    base: 'ATL',
    shift: 'night',
    operationalStatus: 'off_duty',
  });
});

test('CF-B7: crear un supervisor sin datos laborales lo deja disponible y sin código, base ni turno', async () => {
  const { calls, createUser } = setupCreate();

  await createUser(supervisorInput());

  assert.deepEqual(calls[0].employment, {
    employeeCode: null,
    base: null,
    shift: null,
    operationalStatus: 'available',
  });
});

test('CF-B7: crear un supervisor acepta null o vacío en el código, la base y el turno', async () => {
  const { calls, createUser } = setupCreate();

  await createUser(supervisorInput({ employee_code: null, base: '', shift: '  ' }));

  assert.deepEqual(calls[0].employment, {
    employeeCode: null,
    base: null,
    shift: null,
    operationalStatus: 'available',
  });
});

test('CF-B7: crear un super_admin no lleva datos laborales', async () => {
  const { calls, createUser } = setupCreate();

  await createUser(supervisorInput({ role: 'super_admin' }));

  assert.equal(calls[0].employment, null);
});

for (const field of EMPLOYMENT_FIELDS) {
  test(`CF-B7: crear un super_admin con ${field} responde 400 sin guardar nada`, async () => {
    const { calls, createUser } = setupCreate();

    await assert.rejects(
      createUser(supervisorInput({ role: 'super_admin', [field]: VALID_EMPLOYMENT[field] })),
      rejectsWith(400, NOT_SUPERVISOR_MESSAGE)
    );
    assert.deepEqual(calls, []);
  });
}

test('CF-B7: crear un super_admin con un dato laboral inválido responde que no aplica, no el formato', async () => {
  const { createUser } = setupCreate();

  await assert.rejects(
    createUser(supervisorInput({ role: 'super_admin', base: 'XYZ' })),
    rejectsWith(400, NOT_SUPERVISOR_MESSAGE)
  );
});

// Valores inválidos: comunes a crear y a editar.
const INVALID_VALUES = [
  ['un código de 2 caracteres', { employee_code: 'AB' }, EMPLOYEE_CODE_MESSAGE],
  ['un código de 31 caracteres', { employee_code: 'A'.repeat(31) }, EMPLOYEE_CODE_MESSAGE],
  ['un código con guion bajo', { employee_code: 'SUP_001' }, EMPLOYEE_CODE_MESSAGE],
  ['un código con un espacio en medio', { employee_code: 'SUP 001' }, EMPLOYEE_CODE_MESSAGE],
  ['un código con tilde', { employee_code: 'SUPÉ-01' }, EMPLOYEE_CODE_MESSAGE],
  ['un código que no es texto', { employee_code: 1001 }, EMPLOYEE_CODE_MESSAGE],
  ['una base que no es un hub', { base: 'MIA' }, BASE_MESSAGE],
  ['una base de 4 letras', { base: 'ATLX' }, BASE_MESSAGE],
  ['una base que no es texto', { base: 7 }, BASE_MESSAGE],
  ['un turno desconocido', { shift: 'evening' }, SHIFT_MESSAGE],
  ['un turno en mayúsculas', { shift: 'MORNING' }, SHIFT_MESSAGE],
  ['un turno heredado de Object', { shift: 'constructor' }, SHIFT_MESSAGE],
  ['un estado desconocido', { operational_status: 'busy' }, STATUS_MESSAGE],
  ['un estado null', { operational_status: null }, STATUS_MESSAGE],
  ['un estado vacío', { operational_status: '' }, STATUS_MESSAGE],
  ['un estado que no es texto', { operational_status: true }, STATUS_MESSAGE],
];

for (const [label, fields, message] of INVALID_VALUES) {
  test(`CF-B7: crear un supervisor con ${label} responde 400 sin guardar nada`, async () => {
    const { calls, createUser } = setupCreate();

    await assert.rejects(createUser(supervisorInput(fields)), rejectsWith(400, message));
    assert.deepEqual(calls, []);
  });
}

// --- PATCH /users/:id ---

function setupUpdate(target) {
  const createManageUsers = require('../src/application/use-cases/manageUsers');
  const calls = [];
  const userRepository = {
    async findById(id) {
      return id === target.id ? { ...target } : null;
    },
    async updateUser(id, changes) {
      calls.push(changes);
      return { ...target };
    },
  };
  return {
    calls,
    requester: { id: ADMIN_ID, role: 'super_admin' },
    manageUsers: createManageUsers(userRepository),
  };
}

function targetWith(role) {
  return { id: USER_ID, name: 'Laura Gómez', role, is_active: true, pending_activation: false };
}

test('CF-B7: editar un supervisor guarda solo los datos laborales enviados, normalizados', async () => {
  const { calls, requester, manageUsers } = setupUpdate(targetWith('supervisor'));

  await manageUsers.updateUser(requester, USER_ID, { employee_code: 'sup-002', base: 'slc' });

  assert.deepEqual(calls[0], { employment: { employeeCode: 'SUP-002', base: 'SLC' } });
});

test('CF-B7: editar un supervisor con los cuatro campos los guarda todos', async () => {
  const { calls, requester, manageUsers } = setupUpdate(targetWith('supervisor'));

  await manageUsers.updateUser(requester, USER_ID, VALID_EMPLOYMENT);

  assert.deepEqual(calls[0], {
    employment: {
      employeeCode: 'SUP-001',
      base: 'ATL',
      shift: 'morning',
      operationalStatus: 'on_duty',
    },
  });
});

test('CF-B7: editar un supervisor con null quita el código, la base y el turno', async () => {
  const { calls, requester, manageUsers } = setupUpdate(targetWith('supervisor'));

  await manageUsers.updateUser(requester, USER_ID, { employee_code: null, base: null, shift: '' });

  assert.deepEqual(calls[0], { employment: { employeeCode: null, base: null, shift: null } });
});

for (const role of ['crew', 'super_admin']) {
  for (const field of EMPLOYMENT_FIELDS) {
    test(`CF-B7: editar ${field} de un ${role} responde 400 sin guardar nada`, async () => {
      const { calls, requester, manageUsers } = setupUpdate(targetWith(role));

      await assert.rejects(
        manageUsers.updateUser(requester, USER_ID, { [field]: VALID_EMPLOYMENT[field] }),
        rejectsWith(400, NOT_SUPERVISOR_MESSAGE)
      );
      assert.deepEqual(calls, []);
    });
  }
}

for (const [label, fields, message] of INVALID_VALUES) {
  test(`CF-B7: editar un supervisor con ${label} responde 400 sin guardar nada`, async () => {
    const { calls, requester, manageUsers } = setupUpdate(targetWith('supervisor'));

    await assert.rejects(
      manageUsers.updateUser(requester, USER_ID, fields),
      rejectsWith(400, message)
    );
    assert.deepEqual(calls, []);
  });
}

test('CF-B7: pasar un supervisor a super_admin con datos laborales responde 400', async () => {
  const { calls, requester, manageUsers } = setupUpdate(targetWith('supervisor'));

  await assert.rejects(
    manageUsers.updateUser(requester, USER_ID, { role: 'super_admin', base: 'ATL' }),
    rejectsWith(400, NOT_SUPERVISOR_MESSAGE)
  );
  assert.deepEqual(calls, []);
});

test('CF-B7: pasar un supervisor a super_admin borra sus datos laborales y libera su código', async () => {
  const { calls, requester, manageUsers } = setupUpdate(targetWith('supervisor'));

  await manageUsers.updateUser(requester, USER_ID, { role: 'super_admin' });

  assert.deepEqual(calls[0], {
    role: 'super_admin',
    employment: { employeeCode: null, base: null, shift: null, operationalStatus: null },
  });
});

test('CF-B7: pasar un super_admin a supervisor lo deja disponible', async () => {
  const { calls, requester, manageUsers } = setupUpdate(targetWith('super_admin'));

  await manageUsers.updateUser(requester, USER_ID, { role: 'supervisor' });

  assert.deepEqual(calls[0], { role: 'supervisor', employment: { operationalStatus: 'available' } });
});

test('CF-B7: pasar un super_admin a supervisor acepta sus datos laborales en la misma petición', async () => {
  const { calls, requester, manageUsers } = setupUpdate(targetWith('super_admin'));

  await manageUsers.updateUser(requester, USER_ID, {
    role: 'supervisor',
    employee_code: 'SUP-003',
    operational_status: 'leave',
  });

  assert.deepEqual(calls[0], {
    role: 'supervisor',
    employment: { employeeCode: 'SUP-003', operationalStatus: 'leave' },
  });
});

test('CF-B7: reenviar el rol supervisor a un supervisor no toca sus datos laborales', async () => {
  const { calls, requester, manageUsers } = setupUpdate(targetWith('supervisor'));

  await manageUsers.updateUser(requester, USER_ID, { role: 'supervisor' });

  assert.deepEqual(calls[0], { role: 'supervisor' });
});

test('CF-B7: editar sin ningún campo responde 400 con la lista de campos, también los laborales', async () => {
  const { calls, requester, manageUsers } = setupUpdate(targetWith('supervisor'));

  await assert.rejects(
    manageUsers.updateUser(requester, USER_ID, {}),
    rejectsWith(400, EMPTY_UPDATE_MESSAGE)
  );
  assert.deepEqual(calls, []);
});

test('CF-B7: desactivar un supervisor no toca sus datos laborales', async () => {
  const { calls, requester, manageUsers } = setupUpdate(targetWith('supervisor'));

  await manageUsers.deactivateUser(requester, USER_ID);

  assert.deepEqual(calls[0], { isActive: false });
});
