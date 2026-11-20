const { test } = require('node:test');
const assert = require('node:assert/strict');

// Repositorio real con el pool de pg sustituido: no abre conexiones.
const pool = require('../src/adapters/outbound/persistence/pool');
const userRepository = require('../src/adapters/outbound/persistence/repositories/userRepository');

const USER_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const CHANGED_AT = new Date('2026-11-20T12:00:00Z');
const USER_ROW = {
  id: USER_ID,
  name: 'Ana Pérez',
  email: 'ana@aircrew.test',
  role: 'crew',
  password_changed_at: CHANGED_AT,
};

// Cliente o pool falso: guarda cada consulta y responde según el SQL.
function createFakeDb() {
  const db = {
    queries: [],
    released: 0,
    async query(sql, params) {
      db.queries.push({ sql: sql.trim(), params });
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim())) return { rows: [] };
      if (/^SELECT id\s+FROM public\.users\s+WHERE role/i.test(sql.trim())) return { rows: [] };
      return { rows: [USER_ROW], rowCount: 1 };
    },
    release() {
      db.released += 1;
    },
  };
  return db;
}

function useFakeDb(t) {
  const db = createFakeDb();
  t.mock.method(pool, 'query', (sql, params) => db.query(sql, params));
  t.mock.method(pool, 'connect', async () => db);
  return db;
}

function findQuery(db, pattern) {
  const query = db.queries.find(({ sql }) => pattern.test(sql));
  assert.ok(query, `no se encontró una consulta que cumpla ${pattern}`);
  return query;
}

const SETS_CHANGED_AT = /password_changed_at\s*=\s*NOW\(\)/i;
// INSERT INTO public.users (..., password_changed_at) VALUES (..., NOW())
const INSERTS_CHANGED_AT =
  /INSERT INTO public\.users\s*\([^)]*\bpassword_changed_at\b[^)]*\)\s*VALUES\s*\([^)]*NOW\(\)[^)]*\)/i;

// --- CF-B4: password_changed_at ---

test('CF-B4: activar la cuenta actualiza password_changed_at', async (t) => {
  const db = useFakeDb(t);

  await userRepository.activateUser({ activationTokenHash: 'hash-token', passwordHash: 'hash-nuevo' });

  assert.match(findQuery(db, /UPDATE public\.users/).sql, SETS_CHANGED_AT);
});

test('CF-B4: restablecer la contraseña actualiza password_changed_at', async (t) => {
  const db = useFakeDb(t);

  await userRepository.resetPasswordByToken({ tokenHash: 'hash-token', passwordHash: 'hash-nuevo' });

  assert.match(findQuery(db, /UPDATE public\.users/).sql, SETS_CHANGED_AT);
});

test('CF-B4: crear un usuario con contraseña fija password_changed_at', async (t) => {
  const db = useFakeDb(t);

  await userRepository.create({
    name: 'Ana Pérez',
    email: 'ana@aircrew.test',
    passwordHash: 'hash-nuevo',
    role: 'supervisor',
  });

  assert.match(findQuery(db, /INSERT INTO public\.users/).sql, INSERTS_CHANGED_AT);
});

test('CF-B4: crear el primer super_admin fija password_changed_at', async (t) => {
  const db = useFakeDb(t);

  await userRepository.createFirstSuperAdmin({
    name: 'Ana Pérez',
    email: 'ana@aircrew.test',
    passwordHash: 'hash-nuevo',
  });

  assert.match(findQuery(db, /INSERT INTO public\.users/).sql, INSERTS_CHANGED_AT);
});

test('CF-B4: la invitación de un tripulante deja password_changed_at vacío hasta que active la cuenta', async (t) => {
  const db = useFakeDb(t);

  await userRepository.createPendingCrewUser({
    name: 'Ana Pérez',
    email: 'ana@aircrew.test',
    passwordHash: 'hash-temporal',
    activationTokenHash: 'hash-token',
    activationExpiresAt: CHANGED_AT,
  });

  assert.doesNotMatch(findQuery(db, /INSERT INTO public\.users/).sql, /password_changed_at/);
});

test('CF-B3: con la cuenta bloqueada, savePasswordChange guarda el hash, fija password_changed_at y registra changed', async (t) => {
  const db = createFakeDb();
  // Todo va por el cliente de la transacción: una consulta por el pool quedaría fuera del bloqueo.
  t.mock.method(pool, 'query', async () => {
    throw new Error('Consulta fuera de la transacción.');
  });
  t.mock.method(pool, 'connect', async () => db);

  const result = await userRepository.withPasswordResetLock(USER_ID, async (locked) => {
    const current = await locked.findPasswordHash(USER_ID);
    const changedAt = await locked.savePasswordChange({ userId: USER_ID, passwordHash: 'hash-nuevo' });
    return { current, changedAt };
  });

  const sql = db.queries.map((query) => query.sql);
  assert.equal(sql[0], 'BEGIN');
  assert.match(sql[1], /FOR UPDATE/);
  assert.match(sql[2], /SELECT password_hash, is_active/);
  assert.deepEqual(db.queries[2].params, [USER_ID]);
  assert.match(sql[3], /UPDATE public\.users/);
  assert.match(sql[3], /password_hash = \$2/);
  assert.match(sql[3], SETS_CHANGED_AT);
  assert.deepEqual(db.queries[3].params, [USER_ID, 'hash-nuevo']);
  assert.match(sql[4], /INSERT INTO public\.password_reset_events/);
  assert.match(sql[4], /'changed'/);
  assert.equal(sql[5], 'COMMIT');
  assert.equal(db.released, 1);
  assert.equal(result.changedAt, CHANGED_AT);
});

test('CF-B3: savePasswordChange anula el enlace de recuperación pendiente', async (t) => {
  const db = useFakeDb(t);

  await userRepository.withPasswordResetLock(USER_ID, (locked) =>
    locked.savePasswordChange({ userId: USER_ID, passwordHash: 'hash-nuevo' })
  );

  // Así el UPDATE de resetPasswordByToken ya no encuentra el token: no hay un 4.º cambio.
  const { sql } = findQuery(db, /UPDATE public\.users/);
  assert.match(sql, /password_reset_token_hash = NULL/);
  assert.match(sql, /password_reset_expires_at = NULL/);
});

test('CF-B3: findPasswordHash lee el hash y el estado con el pool, sin abrir una transacción', async (t) => {
  const db = useFakeDb(t);

  const result = await userRepository.findPasswordHash(USER_ID);

  assert.equal(db.queries.length, 1);
  assert.match(db.queries[0].sql, /SELECT password_hash, is_active/);
  assert.doesNotMatch(db.queries[0].sql, /FOR UPDATE/);
  assert.deepEqual(db.queries[0].params, [USER_ID]);
  assert.equal(db.released, 0);
  assert.equal(result, USER_ROW);
});

// --- D4: la fecha del último cambio para comparar con el iat del token ---

test('D4: findPasswordHash también lee el rol y password_changed_at', async (t) => {
  const db = useFakeDb(t);

  await userRepository.findPasswordHash(USER_ID);

  assert.match(db.queries[0].sql, /SELECT password_hash, is_active, role, password_changed_at\s/);
});

test('D4: findById lee password_changed_at; la lista de usuarios no', async (t) => {
  const db = useFakeDb(t);

  await userRepository.findById(USER_ID);
  await userRepository.findUsers({ search: null, role: null });

  assert.match(db.queries[0].sql, /\bpassword_changed_at\b/);
  assert.doesNotMatch(db.queries[1].sql, /\bpassword_changed_at\b/);
});

// --- Perfil y foto ---

test('CF-B1: findProfileById trae photo_updated_at de user_photos sin leer los bytes', async (t) => {
  const db = useFakeDb(t);

  await userRepository.findProfileById(USER_ID);

  const { sql, params } = db.queries[0];
  assert.match(sql, /LEFT JOIN public\.user_photos/);
  assert.match(sql, /updated_at AS photo_updated_at/);
  assert.doesNotMatch(sql, /\bdata\b/);
  assert.deepEqual(params, [USER_ID]);
});

const SELECTS_EMPLOYMENT = /u\.employee_code, u\.base, u\.shift, u\.operational_status/;

test('CF-B7: findProfileById y updateProfile traen los datos laborales del supervisor', async (t) => {
  const db = useFakeDb(t);

  await userRepository.findProfileById(USER_ID);
  await userRepository.updateProfile(USER_ID, { phone: null });

  assert.match(db.queries[0].sql, SELECTS_EMPLOYMENT);
  assert.match(db.queries[1].sql, SELECTS_EMPLOYMENT);
});

test('CF-B2: updateProfile guarda null en los campos enviados vacíos y no toca los demás', async (t) => {
  const db = useFakeDb(t);

  await userRepository.updateProfile(USER_ID, { phone: null });

  const { sql, params } = db.queries[0];
  assert.match(sql, /is_active = true/);
  // [id, ¿cambia phone?, phone, ¿cambia residence?, residence, avisos…]
  assert.deepEqual(params, [USER_ID, true, null, false, null, null, null, null]);
});

test('CF-B2: updateProfile pasa cada preferencia a su columna', async (t) => {
  const db = useFakeDb(t);

  await userRepository.updateProfile(USER_ID, {
    residence: 'Cali',
    notifications: { absence_covered: false, replacement_assigned: true },
  });

  const { sql, params } = db.queries[0];
  assert.match(sql, /notify_absence_reported = COALESCE\(\$6, notify_absence_reported\)/);
  assert.match(sql, /notify_absence_covered = COALESCE\(\$7, notify_absence_covered\)/);
  assert.match(sql, /notify_replacement_assigned = COALESCE\(\$8, notify_replacement_assigned\)/);
  assert.deepEqual(params, [USER_ID, false, null, true, 'Cali', null, false, true]);
});

test('CF-B5: savePhoto reemplaza la foto anterior y solo guarda para cuentas activas', async (t) => {
  const db = useFakeDb(t);
  const data = Buffer.from('foto');

  await userRepository.savePhoto(USER_ID, { mimeType: 'image/png', sizeBytes: 4, data });

  const { sql, params } = db.queries[0];
  assert.match(sql, /INSERT INTO public\.user_photos/);
  assert.match(sql, /ON CONFLICT \(user_id\) DO UPDATE/);
  assert.match(sql, /is_active = true/);
  assert.deepEqual(params, [USER_ID, 'image/png', 4, data]);
});

// --- CF-B7: datos laborales del supervisor ---

const EMPLOYEE_CODE_INDEX = 'users_employee_code_unique';

function useFailingDb(t, error) {
  t.mock.method(pool, 'query', async () => {
    throw error;
  });
}

function uniqueViolation(constraint) {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint,
  });
}

test('CF-B7: create guarda los datos laborales del supervisor', async (t) => {
  const db = useFakeDb(t);

  await userRepository.create({
    name: 'Laura Gómez',
    email: 'laura@aircrew.test',
    passwordHash: 'hash-nuevo',
    role: 'supervisor',
    employment: { employeeCode: 'SUP-001', base: 'ATL', shift: 'night', operationalStatus: 'available' },
  });

  const { sql, params } = findQuery(db, /INSERT INTO public\.users/);
  assert.match(sql, /employee_code, base, shift, operational_status/);
  assert.match(sql, INSERTS_CHANGED_AT);
  assert.deepEqual(params, [
    'Laura Gómez',
    'laura@aircrew.test',
    'hash-nuevo',
    'supervisor',
    'SUP-001',
    'ATL',
    'night',
    'available',
  ]);
});

test('CF-B7: create de un super_admin deja los datos laborales en null', async (t) => {
  const db = useFakeDb(t);

  await userRepository.create({
    name: 'Ana Pérez',
    email: 'ana@aircrew.test',
    passwordHash: 'hash-nuevo',
    role: 'super_admin',
    employment: null,
  });

  assert.deepEqual(findQuery(db, /INSERT INTO public\.users/).params.slice(4), [null, null, null, null]);
});

test('CF-B7: updateUser cambia solo los datos laborales enviados y puede dejarlos en null', async (t) => {
  const db = useFakeDb(t);

  await userRepository.updateUser(USER_ID, { employment: { employeeCode: null, shift: 'morning' } });

  const { sql, params } = db.queries[0];
  assert.match(sql, /employee_code = CASE WHEN \$6::boolean THEN \$7 ELSE employee_code END/);
  assert.match(sql, /base = CASE WHEN \$8::boolean THEN \$9 ELSE base END/);
  assert.match(sql, /shift = CASE WHEN \$10::boolean THEN \$11 ELSE shift END/);
  assert.match(
    sql,
    /operational_status = CASE WHEN \$12::boolean THEN \$13 ELSE operational_status END/
  );
  // [id, name, email, role, is_active, ¿código?, código, ¿base?, base, ¿turno?, turno, ¿estado?, estado]
  assert.deepEqual(params, [
    USER_ID, null, null, null, null, true, null, false, null, true, 'morning', false, null,
  ]);
});

test('CF-B7: updateUser sin datos laborales no los toca', async (t) => {
  const db = useFakeDb(t);

  await userRepository.updateUser(USER_ID, { isActive: false });

  assert.deepEqual(db.queries[0].params, [
    USER_ID, null, null, null, false, false, null, false, null, false, null, false, null,
  ]);
});

for (const [label, run] of [
  [
    'create',
    () =>
      userRepository.create({
        name: 'Laura Gómez',
        email: 'laura@aircrew.test',
        passwordHash: 'hash-nuevo',
        role: 'supervisor',
        employment: { employeeCode: 'SUP-001' },
      }),
  ],
  ['updateUser', () => userRepository.updateUser(USER_ID, { employment: { employeeCode: 'SUP-001' } })],
]) {
  test(`CF-B7: ${label} con un código de empleado repetido responde 409`, async (t) => {
    useFailingDb(t, uniqueViolation(EMPLOYEE_CODE_INDEX));

    await assert.rejects(run(), (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.message, 'Ya existe un supervisor con ese código de empleado.');
      return true;
    });
  });

  test(`CF-B7: ${label} con un email repetido sigue respondiendo 409 por el email`, async (t) => {
    useFailingDb(t, uniqueViolation('users_email_key'));

    await assert.rejects(run(), (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.message, 'Ya existe un usuario con ese email.');
      return true;
    });
  });
}

// --- M4: solo los supervisores tienen datos laborales (CHECK de admin_db.sql) ---

const EMPLOYMENT_CHECK = 'users_employment_supervisor_check';
const ROLE_CHANGED_MESSAGE = 'El usuario cambió de rol; vuelve a intentarlo.';

function checkViolation(constraint) {
  return Object.assign(new Error('new row for relation "users" violates check constraint'), {
    code: '23514',
    constraint,
  });
}

test('M4: updateUser convierte la violación del CHECK de los datos laborales en un 409 claro', async (t) => {
  useFailingDb(t, checkViolation(EMPLOYMENT_CHECK));

  await assert.rejects(
    userRepository.updateUser(USER_ID, { employment: { shift: 'night' } }),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.message, ROLE_CHANGED_MESSAGE);
      return true;
    }
  );
});

test('M4: updateUser no convierte en 409 la violación de otro CHECK', async (t) => {
  const cause = checkViolation('users_base_check');
  useFailingDb(t, cause);

  await assert.rejects(
    userRepository.updateUser(USER_ID, { employment: { base: 'XXX' } }),
    (error) => {
      assert.equal(error, cause);
      assert.equal(error.status, undefined);
      return true;
    }
  );
});

test('M4: admin_db.sql crea el CHECK de los datos laborales en un DO que se puede repetir y valida las filas existentes', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const sql = fs.readFileSync(path.join(__dirname, '../../../database/admin_db.sql'), 'utf8');

  const blocks = [...sql.matchAll(/DO \$\$([\s\S]*?)END \$\$;/g)].map((match) => match[1]);
  const block = blocks.find((body) => body.includes(`ADD CONSTRAINT ${EMPLOYMENT_CHECK}`));
  assert.ok(block, `falta un bloque DO que añada ${EMPLOYMENT_CHECK}`);
  assert.match(
    block,
    /IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint\s+WHERE conrelid = 'public\.users'::regclass\s+AND conname = 'users_employment_supervisor_check'\s*\) THEN\s+ALTER TABLE public\.users\s+ADD CONSTRAINT users_employment_supervisor_check\s+CHECK \(role = 'supervisor' OR \(employee_code IS NULL AND base IS NULL AND shift IS NULL AND operational_status IS NULL\)\);/
  );
  // Sin NOT VALID: PostgreSQL comprueba también las filas que ya existen.
  assert.doesNotMatch(sql, /NOT VALID/i);
});

test('CF-B7: admin_db.sql crea el índice único parcial del código y los CHECK de los datos laborales', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const sql = fs.readFileSync(path.join(__dirname, '../../../database/admin_db.sql'), 'utf8');

  // El nombre del índice es el que userRepository reconoce en el 23505.
  assert.equal(EMPLOYEE_CODE_INDEX, 'users_employee_code_unique');
  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS users_employee_code_unique\s+ON public\.users \(employee_code\)\s+WHERE employee_code IS NOT NULL;/
  );
  for (const column of [
    'employee_code VARCHAR(30)',
    'base VARCHAR(3)',
    'shift TEXT',
    'operational_status TEXT',
  ]) {
    assert.ok(sql.includes(`ADD COLUMN IF NOT EXISTS ${column}`), `falta el ALTER de ${column}`);
  }
  assert.match(sql, /base IN \('ATL', 'BOS', 'DTW', 'LAX', 'MSP', 'JFK', 'LGA', 'SLC', 'SEA'\)/);
  assert.match(sql, /shift IN \('morning', 'afternoon', 'night'\)/);
  assert.match(sql, /operational_status IN \('available', 'on_duty', 'off_duty', 'leave'\)/);
});
