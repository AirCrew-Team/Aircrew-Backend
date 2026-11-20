const pool = require('../pool');

// pending_activation: tripulante invitado que todavía no define su contraseña.
const userColumns = `id, name, email, role, is_active, created_at,
       activation_token_hash IS NOT NULL AS pending_activation`;

async function findById(id) {
  const { rows } = await pool.query(
    `SELECT ${userColumns}
     FROM public.users
     WHERE id = $1
     LIMIT 1`,
    [id]
  );

  return rows[0] || null;
}

function toDuplicateEmailError(cause) {
  if (cause.code === '23505') {
    const error = new Error('Ya existe un usuario con ese email.');
    error.status = 409;
    return error;
  }

  return cause;
}

async function create({ name, email, passwordHash, role }) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role, is_active, created_at`,
      [name, email, passwordHash, role]
    );

    return rows[0];
  } catch (cause) {
    throw toDuplicateEmailError(cause);
  }
}

async function createPendingCrewUser({
  name,
  email,
  passwordHash,
  activationTokenHash,
  activationExpiresAt,
}) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.users
         (name, email, password_hash, role, is_active, activation_token_hash, activation_expires_at)
       VALUES ($1, $2, $3, 'crew', false, $4, $5)
       RETURNING id, name, email, role, is_active, created_at`,
      [name, email, passwordHash, activationTokenHash, activationExpiresAt]
    );

    return rows[0];
  } catch (cause) {
    throw toDuplicateEmailError(cause);
  }
}

// Borra una invitación cuyo correo no se pudo enviar. Solo toca cuentas crew
// pendientes de activación: nunca una cuenta activa.
async function deletePendingCrewUser(id) {
  const { rowCount } = await pool.query(
    `DELETE FROM public.users
     WHERE id = $1
       AND role = 'crew'
       AND is_active = false
       AND activation_token_hash IS NOT NULL`,
    [id]
  );

  return rowCount > 0;
}

async function activateUser({ activationTokenHash, passwordHash }) {
  const { rows } = await pool.query(
    `UPDATE public.users
     SET password_hash = $2,
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
    `SELECT id, name, email, role, is_active, password_hash,
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
    });
  });
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
      `INSERT INTO public.users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
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
    `SELECT ${userColumns}
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

// Actualiza solo los campos recibidos.
async function updateUser(id, { name, email, role, isActive }) {
  try {
    const { rows } = await pool.query(
      `UPDATE public.users
       SET name = COALESCE($2, name),
           email = COALESCE($3, email),
           role = COALESCE($4, role),
           is_active = COALESCE($5, is_active)
       WHERE id = $1
       RETURNING ${userColumns}`,
      [id, name ?? null, email ?? null, role ?? null, isActive ?? null]
    );

    return rows[0] || null;
  } catch (cause) {
    throw toDuplicateEmailError(cause);
  }
}

module.exports = {
  findUsers,
  findUsersByIds,
  updateUser,
  findById,
  create,
  createPendingCrewUser,
  deletePendingCrewUser,
  activateUser,
  findPendingActivationByToken,
  findByEmail,
  withPasswordResetLock,
  countPasswordResetEvents,
  findByPasswordResetToken,
  resetPasswordByToken,
  createFirstSuperAdmin,
};