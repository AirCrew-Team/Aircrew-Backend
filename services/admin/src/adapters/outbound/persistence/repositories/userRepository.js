const pool = require('../pool');

// pending_activation: usuario invitado que todavía no define su contraseña.
const userColumns = `id, name, email, role, is_active, created_at,
       activation_token_hash IS NOT NULL AS pending_activation`;

// Lista y ficha de la pantalla Usuarios: también el celular y los datos laborales
// del supervisor (null en los demás roles).
const listColumns = `${userColumns}, phone,
       employee_code, base, shift, operational_status`;

// password_changed_at solo para comparar con el iat del token: los casos de uso lo
// quitan de la respuesta.
async function findById(id) {
  const { rows } = await pool.query(
    `SELECT ${userColumns}, password_changed_at
     FROM public.users
     WHERE id = $1
     LIMIT 1`,
    [id]
  );

  return rows[0] || null;
}

// Ficha de la pantalla Usuarios (GET /users/:id). Sin password_changed_at.
async function findUserDetailById(id) {
  const { rows } = await pool.query(
    `SELECT ${listColumns}
     FROM public.users
     WHERE id = $1`,
    [id]
  );

  return rows[0] || null;
}

// Índice único parcial de database/admin_db.sql.
const EMPLOYEE_CODE_INDEX = 'users_employee_code_unique';
// CHECK de database/admin_db.sql: solo los supervisores tienen datos laborales.
const EMPLOYMENT_CHECK = 'users_employment_supervisor_check';

// 23505: el código de empleado repetido tiene su mensaje; cualquier otro es el email.
function toDuplicateError(cause) {
  if (cause.code === '23505') {
    const isEmployeeCode = cause.constraint === EMPLOYEE_CODE_INDEX;
    const error = new Error(
      isEmployeeCode
        ? 'Ya existe un supervisor con ese código de empleado.'
        : 'Ya existe un usuario con ese email.'
    );
    error.status = 409;
    error.code = isEmployeeCode ? 'duplicate_employee_code' : 'duplicate_email';
    error.field = isEmployeeCode ? 'employee_code' : 'email';
    return error;
  }

  return cause;
}

// employment: datos laborales de un supervisor; null para los demás roles.
async function create({ name, email, passwordHash, role, employment }) {
  const job = employment || {};

  try {
    const { rows } = await pool.query(
      `INSERT INTO public.users (name, email, password_hash, role, password_changed_at,
                                 employee_code, base, shift, operational_status)
       VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, $8)
       RETURNING id, name, email, role, is_active, created_at`,
      [
        name,
        email,
        passwordHash,
        role,
        job.employeeCode ?? null,
        job.base ?? null,
        job.shift ?? null,
        job.operationalStatus ?? null,
      ]
    );

    return rows[0];
  } catch (cause) {
    throw toDuplicateError(cause);
  }
}

// Cuenta invitada: nace inactiva, con el enlace de activación y una contraseña que
// nadie conoce. password_changed_at queda vacío hasta que la persona la active.
// employment: datos laborales de un supervisor; null para los demás roles.
async function createPendingUser({
  name,
  email,
  phone = null,
  role,
  employment,
  passwordHash,
  activationTokenHash,
  activationExpiresAt,
}) {
  const job = employment || {};

  try {
    const { rows } = await pool.query(
      `INSERT INTO public.users
         (name, email, phone, password_hash, role, is_active,
          activation_token_hash, activation_expires_at,
          employee_code, base, shift, operational_status)
       VALUES ($1, $2, $3, $4, $5, false, $6, $7, $8, $9, $10, $11)
       RETURNING ${listColumns}`,
      [
        name,
        email,
        phone,
        passwordHash,
        role,
        activationTokenHash,
        activationExpiresAt,
        job.employeeCode ?? null,
        job.base ?? null,
        job.shift ?? null,
        job.operationalStatus ?? null,
      ]
    );

    return rows[0];
  } catch (cause) {
    throw toDuplicateError(cause);
  }
}

// Deshace un alta que no se pudo terminar (falló Crew o el correo). Solo toca
// cuentas pendientes de activación: nunca una cuenta activa.
async function deletePendingUser(id) {
  const { rowCount } = await pool.query(
    `DELETE FROM public.users
     WHERE id = $1
       AND is_active = false
       AND activation_token_hash IS NOT NULL`,
    [id]
  );

  return rowCount > 0;
}

// Reenvío de la invitación: enlace nuevo que anula el anterior. Solo cuentas
// pendientes de activación; devuelve null si la cuenta ya está activa o no existe.
async function renewActivation(id, { activationTokenHash, activationExpiresAt }) {
  const { rows } = await pool.query(
    `UPDATE public.users
     SET activation_token_hash = $2,
         activation_expires_at = $3
     WHERE id = $1
       AND is_active = false
       AND activation_token_hash IS NOT NULL
     RETURNING id, name, email`,
    [id, activationTokenHash, activationExpiresAt]
  );

  return rows[0] || null;
}

async function activateUser({ activationTokenHash, passwordHash }) {
  const { rows } = await pool.query(
    `UPDATE public.users
     SET password_hash = $2,
         password_changed_at = NOW(),
         is_active = true,
         activation_token_hash = NULL,
         activation_expires_at = NULL
     WHERE activation_token_hash = $1
       AND activation_expires_at > NOW()
       AND is_active = false
     RETURNING id, name, email, role`,
    [activationTokenHash, passwordHash]
  );

  return rows[0] || null;
}

// Solo lectura, con las mismas condiciones del UPDATE de activateUser.
async function findPendingActivationByToken(activationTokenHash) {
  const { rows } = await pool.query(
    `SELECT id
     FROM public.users
     WHERE activation_token_hash = $1
       AND activation_expires_at > NOW()
       AND is_active = false
     LIMIT 1`,
    [activationTokenHash]
  );

  return rows[0] || null;
}

async function findByEmail(email) {
  const { rows } = await pool.query(
    `SELECT id, name, email, role, is_active, password_hash, password_changed_at,
            activation_token_hash IS NOT NULL AS pending_activation
     FROM public.users
     WHERE LOWER(email) = LOWER($1)
     LIMIT 1`,
    [email]
  );

  return rows[0] || null;
}

// Ejecuta fn(client) dentro de una transacción.
async function inTransaction(fn) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Guarda el hash del token de recuperación (reemplaza el anterior) y registra la solicitud.
// Solo se usa dentro de withPasswordResetLock, con el cliente de su transacción.
async function savePasswordResetToken(client, { userId, tokenHash, expiresAt }) {
  await client.query(
    `UPDATE public.users
     SET password_reset_token_hash = $2,
         password_reset_expires_at = $3
     WHERE id = $1`,
    [userId, tokenHash, expiresAt]
  );
  await client.query(
    `INSERT INTO public.password_reset_events (user_id, event)
     VALUES ($1, 'requested')`,
    [userId]
  );
}

// Eventos 'requested' o 'changed' de una cuenta posteriores a `since`.
// `db` es el pool o el cliente de una transacción.
async function countPasswordResetEvents({ userId, event, since }, db = pool) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM public.password_reset_events
     WHERE user_id = $1
       AND event = $2
       AND created_at > $3`,
    [userId, event, since]
  );

  return rows[0].count;
}

// Contraseña actual incorrecta en el cambio con sesión: un evento 'change_failed'.
// Con el pool: el fallo no abre una transacción ni bloquea la cuenta.
async function recordPasswordChangeFailure(userId) {
  await pool.query(
    `INSERT INTO public.password_reset_events (user_id, event)
     VALUES ($1, 'change_failed')`,
    [userId]
  );
}

// Fallos de login de un correo (ya normalizado) posteriores a `since`.
async function countLoginFailures({ email, since }) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM public.login_failures
     WHERE email = $1
       AND created_at > $2`,
    [email, since]
  );

  return rows[0].count;
}

// Un fallo de login por correo, aunque la cuenta no exista.
async function recordLoginFailure(email) {
  await pool.query(
    `INSERT INTO public.login_failures (email)
     VALUES ($1)`,
    [email]
  );
}

// Ejecuta fn(locked) en una transacción con la fila de la cuenta bloqueada (FOR UPDATE).
// Otra solicitud de la misma cuenta espera al COMMIT y ya ve el evento guardado.
// `locked` cuenta y guarda con el cliente de esa transacción.
async function withPasswordResetLock(userId, fn) {
  return inTransaction(async (client) => {
    await client.query(
      `SELECT id
       FROM public.users
       WHERE id = $1
       FOR UPDATE`,
      [userId]
    );

    return fn({
      countPasswordResetEvents: (args) => countPasswordResetEvents(args, client),
      savePasswordResetToken: (args) => savePasswordResetToken(client, args),
      findPasswordHash: (id) => findPasswordHash(id, client),
      savePasswordChange: (args) => savePasswordChange(client, args),
    });
  });
}

// Hash, estado, rol y fecha del último cambio de la cuenta.
// `db` es el pool o el cliente de una transacción.
async function findPasswordHash(userId, db = pool) {
  const { rows } = await db.query(
    `SELECT password_hash, is_active, role, password_changed_at
     FROM public.users
     WHERE id = $1`,
    [userId]
  );

  return rows[0] || null;
}

// Cambio de contraseña con sesión: guarda el hash, la fecha y el evento 'changed'.
// Anula el enlace de recuperación pendiente: un reset que ya pasó la comprobación
// no puede sumar otro cambio después de este.
async function savePasswordChange(client, { userId, passwordHash }) {
  const { rows } = await client.query(
    `UPDATE public.users
     SET password_hash = $2,
         password_changed_at = NOW(),
         password_reset_token_hash = NULL,
         password_reset_expires_at = NULL
     WHERE id = $1
     RETURNING password_changed_at`,
    [userId, passwordHash]
  );
  await client.query(
    `INSERT INTO public.password_reset_events (user_id, event)
     VALUES ($1, 'changed')`,
    [userId]
  );

  return rows[0].password_changed_at;
}

// Cuenta dueña del token. El caso de uso revisa el vencimiento y el estado.
async function findByPasswordResetToken(tokenHash) {
  const { rows } = await pool.query(
    `SELECT id, name, email, role, is_active, password_reset_expires_at,
            activation_token_hash IS NOT NULL AS pending_activation
     FROM public.users
     WHERE password_reset_token_hash = $1
     LIMIT 1`,
    [tokenHash]
  );

  return rows[0] || null;
}

// Cambia la contraseña si el token sigue vigente, lo borra y registra el cambio.
// Devuelve null si otra petición ya usó el token o si venció.
async function resetPasswordByToken({ tokenHash, passwordHash }) {
  return inTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE public.users
       SET password_hash = $2,
           password_changed_at = NOW(),
           password_reset_token_hash = NULL,
           password_reset_expires_at = NULL
       WHERE password_reset_token_hash = $1
         AND password_reset_expires_at > NOW()
         AND is_active = true
       RETURNING id, name, email, role`,
      [tokenHash, passwordHash]
    );

    if (!rows[0]) return null;

    await client.query(
      `INSERT INTO public.password_reset_events (user_id, event)
       VALUES ($1, 'changed')`,
      [rows[0].id]
    );

    return rows[0];
  });
}

async function createFirstSuperAdmin({ name, email, passwordHash }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [73184219]);

    const { rows: existingUsers } = await client.query(
      `SELECT id
       FROM public.users
       WHERE role = $1
       LIMIT 1`,
      ['super_admin']
    );

    if (existingUsers.length > 0) {
      const error = new Error('El super_admin inicial ya existe.');
      error.status = 409;
      throw error;
    }

    const { rows } = await client.query(
      `INSERT INTO public.users (name, email, password_hash, role, password_changed_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id, name, email, role, is_active, created_at`,
      [name, email, passwordHash, 'super_admin']
    );

    await client.query('COMMIT');
    return rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Busca por nombre o email (sin importar mayúsculas) y filtra por rol.
async function findUsers({ search, role }) {
  const { rows } = await pool.query(
    `SELECT ${listColumns}
     FROM public.users
     WHERE ($1::text IS NULL OR name ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%')
       AND ($2::text IS NULL OR role = $2)
     ORDER BY name`,
    [search, role]
  );

  return rows;
}

async function findUsersByIds(ids) {
  const { rows } = await pool.query(
    `SELECT id, name, email, is_active
     FROM public.users
     WHERE id = ANY($1::uuid[])`,
    [ids]
  );

  return rows;
}

// Actualiza solo los campos recibidos. Los datos laborales enviados pueden pasar a null.
async function updateUser(id, { name, email, phone, role, isActive, employment = {} }) {
  const sent = (key) => employment[key] !== undefined;

  try {
    const { rows } = await pool.query(
      `UPDATE public.users
       SET name = COALESCE($2, name),
           email = COALESCE($3, email),
           role = COALESCE($4, role),
           is_active = COALESCE($5, is_active),
           employee_code = CASE WHEN $6::boolean THEN $7 ELSE employee_code END,
           base = CASE WHEN $8::boolean THEN $9 ELSE base END,
           shift = CASE WHEN $10::boolean THEN $11 ELSE shift END,
           operational_status = CASE WHEN $12::boolean THEN $13 ELSE operational_status END,
           phone = CASE WHEN $14::boolean THEN $15 ELSE phone END
       WHERE id = $1
       RETURNING ${listColumns}`,
      [
        id,
        name ?? null,
        email ?? null,
        role ?? null,
        isActive ?? null,
        sent('employeeCode'),
        employment.employeeCode ?? null,
        sent('base'),
        employment.base ?? null,
        sent('shift'),
        employment.shift ?? null,
        sent('operationalStatus'),
        employment.operationalStatus ?? null,
        phone !== undefined,
        phone ?? null,
      ]
    );

    return rows[0] || null;
  } catch (cause) {
    // 23514 del CHECK: otra petición cambió el rol después de validar los datos laborales.
    if (cause.code === '23514' && cause.constraint === EMPLOYMENT_CHECK) {
      const error = new Error('El usuario cambió de rol; vuelve a intentarlo.');
      error.status = 409;
      throw error;
    }
    throw toDuplicateError(cause);
  }
}

// Perfil de Configuración: la fecha de la foto, nunca sus bytes.
const profileColumns = `u.id, u.name, u.email, u.role, u.is_active, u.created_at,
       u.phone, u.residence, u.password_changed_at,
       u.notify_absence_reported, u.notify_absence_covered, u.notify_replacement_assigned,
       u.employee_code, u.base, u.shift, u.operational_status,
       p.updated_at AS photo_updated_at`;

async function findProfileById(id) {
  const { rows } = await pool.query(
    `SELECT ${profileColumns}
     FROM public.users u
     LEFT JOIN public.user_photos p ON p.user_id = u.id
     WHERE u.id = $1
     LIMIT 1`,
    [id]
  );

  return rows[0] || null;
}

// Solo cambia los campos enviados; phone y residence pueden pasar a null.
// Devuelve null si la cuenta no existe o está desactivada.
async function updateProfile(id, { phone, residence, notifications = {} }) {
  const { rows } = await pool.query(
    `WITH u AS (
       UPDATE public.users
       SET phone = CASE WHEN $2::boolean THEN $3 ELSE phone END,
           residence = CASE WHEN $4::boolean THEN $5 ELSE residence END,
           notify_absence_reported = COALESCE($6, notify_absence_reported),
           notify_absence_covered = COALESCE($7, notify_absence_covered),
           notify_replacement_assigned = COALESCE($8, notify_replacement_assigned)
       WHERE id = $1
         AND is_active = true
       RETURNING *
     )
     SELECT ${profileColumns}
     FROM u
     LEFT JOIN public.user_photos p ON p.user_id = u.id`,
    [
      id,
      phone !== undefined,
      phone ?? null,
      residence !== undefined,
      residence ?? null,
      notifications.absence_reported ?? null,
      notifications.absence_covered ?? null,
      notifications.replacement_assigned ?? null,
    ]
  );

  return rows[0] || null;
}

// Guarda o reemplaza la foto. Devuelve su fecha, o null si la cuenta no está activa.
async function savePhoto(userId, { mimeType, sizeBytes, data }) {
  const { rows } = await pool.query(
    `INSERT INTO public.user_photos (user_id, mime_type, size_bytes, data, updated_at)
     SELECT id, $2::text, $3::integer, $4::bytea, NOW()
     FROM public.users
     WHERE id = $1
       AND is_active = true
     ON CONFLICT (user_id) DO UPDATE
     SET mime_type = EXCLUDED.mime_type,
         size_bytes = EXCLUDED.size_bytes,
         data = EXCLUDED.data,
         updated_at = EXCLUDED.updated_at
     RETURNING updated_at`,
    [userId, mimeType, sizeBytes, data]
  );

  return rows[0] ? rows[0].updated_at : null;
}

async function findPhoto(userId) {
  const { rows } = await pool.query(
    `SELECT mime_type, data
     FROM public.user_photos
     WHERE user_id = $1`,
    [userId]
  );

  return rows[0] || null;
}

async function deletePhoto(userId) {
  const { rowCount } = await pool.query(
    `DELETE FROM public.user_photos
     WHERE user_id = $1`,
    [userId]
  );

  return rowCount > 0;
}

// super_admin activos sin contar esta cuenta: no se elimina al último.
async function countActiveSuperAdminsExcept(id) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS count
     FROM public.users
     WHERE role = 'super_admin' AND is_active AND id <> $1`,
    [id]
  );

  return rows[0].count;
}

// Eliminar la cuenta de forma definitiva (después de borrar sus datos en los demás
// servicios). Su foto y sus eventos de contraseña se van con ella (ON DELETE CASCADE);
// sus fallos de login, por su correo. Con la fila se van los enlaces de invitación y
// de recuperación. El bloqueo evita que dos super_admin se eliminen el uno al otro a
// la vez y quede ninguno. Devuelve 'deleted', 'not_found' o 'last_super_admin'.
async function deleteUser(id) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [73184220]);

    const { rows: found } = await client.query(
      `SELECT role,
              (SELECT count(*)::int FROM public.users
               WHERE role = 'super_admin' AND is_active AND id <> $1) AS others
       FROM public.users
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );

    if (!found[0] || (found[0].role === 'super_admin' && found[0].others === 0)) {
      await client.query('ROLLBACK');
      return found[0] ? 'last_super_admin' : 'not_found';
    }

    const { rows: deleted } = await client.query(
      `DELETE FROM public.users
       WHERE id = $1
       RETURNING email`,
      [id]
    );
    await client.query('DELETE FROM public.login_failures WHERE email = $1', [deleted[0].email]);
    await client.query('COMMIT');

    return 'deleted';
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  countActiveSuperAdminsExcept,
  deleteUser,
  findUserDetailById,
  findProfileById,
  updateProfile,
  savePhoto,
  findPhoto,
  deletePhoto,
  findUsers,
  findUsersByIds,
  updateUser,
  findById,
  create,
  createPendingUser,
  renewActivation,
  deletePendingUser,
  activateUser,
  findPendingActivationByToken,
  findByEmail,
  withPasswordResetLock,
  findPasswordHash,
  countPasswordResetEvents,
  recordPasswordChangeFailure,
  countLoginFailures,
  recordLoginFailure,
  findByPasswordResetToken,
  resetPasswordByToken,
  createFirstSuperAdmin,
};