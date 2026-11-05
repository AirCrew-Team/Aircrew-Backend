const pool = require('../pool');

async function findById(id) {
  const { rows } = await pool.query(
    `SELECT id, name, email, role, is_active, created_at
     FROM public.users
     WHERE id = $1
     LIMIT 1`,
    [id]
  );

  return rows[0] || null;
}

function toDuplicateEmailError(cause) {
  if (cause.code === '23505') {
    const error = new Error('A user with this email already exists.');
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

async function findByEmail(email) {
  const { rows } = await pool.query(
    `SELECT id, name, email, role, is_active, password_hash
     FROM public.users
     WHERE LOWER(email) = LOWER($1)
     LIMIT 1`,
    [email]
  );

  return rows[0] || null;
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
      const error = new Error('The initial super_admin already exists.');
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

module.exports = {
  findById,
  create,
  createPendingCrewUser,
  activateUser,
  findByEmail,
  createFirstSuperAdmin,
};