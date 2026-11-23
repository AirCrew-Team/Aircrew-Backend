const pool = require('../pool');

// base: la asigna Admin y es la única fuente. Sale también como base_code porque
// así la leen las reglas, el turno y Recommendation.
// Las fechas sin hora salen como texto AAAA-MM-DD: si se dejan como DATE, el
// driver las convierte a medianoche local y en Colombia se correrían un día.
const crewColumns = `id, user_id, employee_code, position, base, base AS base_code,
       rank, ratings, english_level,
       to_char(medical_expires_on, 'YYYY-MM-DD') AS medical_expires_on,
       to_char(hire_date, 'YYYY-MM-DD') AS hire_date,
       phone, radio_channel, current_location, status, standby_location,
       minutes_to_ramp, standby_until, is_active, created_at`;

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

// Siguiente código libre de la secuencia: AC-0001, AC-0002…
const NEXT_EMPLOYEE_CODE = `'AC-' || lpad(nextval('public.crew_employee_code_seq')::text, 4, '0')`;
// Si el código generado ya lo tenía alguien (asignado a mano), se prueba el siguiente.
const MAX_GENERATED_CODE_ATTEMPTS = 20;

function isDuplicateEmployeeCode(cause) {
  return (
    cause.code === '23505' &&
    Boolean(cause.constraint) &&
    cause.constraint.includes('employee_code')
  );
}

// employeeCode null: el código lo asigna la base con la secuencia.
async function createCrewMember({
  userId,
  employeeCode = null,
  position,
  base = null,
  currentLocation = null,
  status = 'available',
  isActive = true,
  rank = null,
}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const { rows } = await pool.query(
        `INSERT INTO public.crew_members
           (user_id, employee_code, position, base, current_location, status, is_active, rank)
         VALUES ($1, COALESCE($2, ${NEXT_EMPLOYEE_CODE}), $3, $4, $5, $6, $7, $8)
         RETURNING ${crewColumns}`,
        [userId, employeeCode, position, base, currentLocation, status, isActive, rank]
      );

      return rows[0];
    } catch (cause) {
      const retry =
        employeeCode === null &&
        isDuplicateEmployeeCode(cause) &&
        attempt < MAX_GENERATED_CODE_ATTEMPTS;

      if (!retry) {
        throw toDuplicateError(cause);
      }
    }
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
  { employeeCode, position, base, status, isActive, rank }
) {
  try {
    const { rows } = await pool.query(
      `UPDATE public.crew_members
       SET employee_code = COALESCE($2, employee_code),
           position = COALESCE($3, position),
           base = CASE WHEN $4::boolean THEN $5 ELSE base END,
           status = COALESCE($6, status),
           is_active = COALESCE($7, is_active),
           rank = COALESCE($8, rank),
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
        rank ?? null,
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

// Admin eliminó la cuenta del tripulante: se borra todo lo suyo en una transacción.
// - Las ausencias de otros en las que esperaba dar «Enterado» como reemplazo vuelven
//   a la cola, como cuando vence el plazo (Flights ya devolvió el puesto).
// - Sus ausencias: con ellas se van sus hijas, comprobantes y eventos (ON DELETE CASCADE).
// - Su certificación (con archivo e historial) y su perfil.
// Repetirlo no falla: devuelve 0 en todo.
async function eraseCrewUser(userId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const reopened = await client.query(
      `WITH reopened AS (
         UPDATE public.absences
         SET status = 'reported', replacement_user_id = NULL, approved_by = NULL,
             approved_at = NULL, deadline_at = NULL, replacement_option = NULL
         WHERE replacement_user_id = $1 AND status = 'pending_ack' AND crew_user_id <> $1
         RETURNING id
       )
       INSERT INTO public.absence_events (absence_id, type, text)
       SELECT id, 'candidate_missed', 'Se eliminó la cuenta del reemplazo: la solicitud vuelve a la cola'
       FROM reopened`,
      [userId]
    );
    const absences = await client.query(
      'DELETE FROM public.absences WHERE crew_user_id = $1',
      [userId]
    );
    const certifications = await client.query(
      'DELETE FROM public.crew_certifications WHERE crew_user_id = $1',
      [userId]
    );
    const profile = await client.query(
      'DELETE FROM public.crew_members WHERE user_id = $1',
      [userId]
    );

    await client.query('COMMIT');

    return {
      profile: profile.rowCount,
      certifications: certifications.rowCount,
      absences: absences.rowCount,
      reopened_absences: reopened.rowCount,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  createCrewMember,
  findCrewMembers,
  findCrewMemberByUserId,
  updateCrewMember,
  eraseCrewUser,
  deleteCrewMemberWithoutHistory,
};
