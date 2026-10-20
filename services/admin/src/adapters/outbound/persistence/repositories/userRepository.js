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

async function create({ name, email, passwordHash, role }) {
  const { rows } = await pool.query(
    `INSERT INTO public.users (name, email, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, email, role, is_active, created_at`,
    [name, email, passwordHash, role]
  );

  return rows[0];
}

module.exports = { findById, create };