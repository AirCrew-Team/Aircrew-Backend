const pool = require('../pool');

const crewColumns = `id, user_id, employee_code, position, base, current_location,
       status, is_active, created_at`;

// 23505: el código de empleado o la cuenta ya tienen perfil.
function toDuplicateError(cause) {
  if (cause.code === '23505') {
    const error = new Error(
      cause.constraint && cause.constraint.includes('employee_code')
        ? 'Ya existe un tripulante con ese código de empleado.'
        : 'Esa cuenta ya tiene un perfil de tripulante.'
    );
    error.status = 409;
    return error;
  }

  return cause;
}

async function createCrewMember({
  userId,
  employeeCode,
  position,
  base = null,
  currentLocation = null,
  status = 'available',
  isActive = true,
}) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.crew_members
         (user_id, employee_code, position, base, current_location, status, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${crewColumns}`,
      [userId, employeeCode, position, base, currentLocation, status, isActive]
    );

    return rows[0];
  } catch (cause) {
    throw toDuplicateError(cause);
  }
}

async function findCrewMembers() {
  const { rows } = await pool.query(
    `SELECT ${crewColumns}
     FROM public.crew_members
     ORDER BY employee_code`
  );

  return rows;
}

async function findCrewMemberByUserId(userId) {
  const { rows } = await pool.query(
    `SELECT ${crewColumns}
     FROM public.crew_members
     WHERE user_id = $1`,
    [userId]
  );

  return rows[0] || null;
}

// Actualiza solo los campos recibidos. base enviada puede pasar a null.
async function updateCrewMember(
  userId,
  { employeeCode, position, base, status, isActive }
) {
  try {
    const { rows } = await pool.query(
      `UPDATE public.crew_members
       SET employee_code = COALESCE($2, employee_code),
           position = COALESCE($3, position),
           base = CASE WHEN $4::boolean THEN $5 ELSE base END,
           status = COALESCE($6, status),
           is_active = COALESCE($7, is_active),
           updated_at = now()
       WHERE user_id = $1
       RETURNING ${crewColumns}`,
      [
        userId,
        employeeCode ?? null,
        position ?? null,
        base !== undefined,
        base ?? null,
        status ?? null,
        isActive ?? null,
      ]
    );

    return rows[0] || null;
  } catch (cause) {
    throw toDuplicateError(cause);
  }
}

// Borra un perfil sin historial. Lo usa Admin cuando el alta no se pudo
// terminar; un perfil con ausencias nunca se borra. Devuelve:
// 'deleted', 'not_found' o 'has_history'.
async function deleteCrewMemberWithoutHistory(userId) {
  const { rowCount } = await pool.query(
    `DELETE FROM public.crew_members cm
     WHERE cm.user_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM public.absences a WHERE a.crew_user_id = cm.user_id
       )`,
    [userId]
  );

  if (rowCount > 0) {
    return 'deleted';
  }

  return (await findCrewMemberByUserId(userId)) ? 'has_history' : 'not_found';
}

module.exports = {
  createCrewMember,
  findCrewMembers,
  findCrewMemberByUserId,
  updateCrewMember,
  deleteCrewMemberWithoutHistory,
};
