const pool = require('../pool');

const absenceColumns = `id, crew_user_id, flight_id, flight_number,
       flight_departure_at, reason, notes, status, replacement_user_id,
       covered_at, created_at`;

// Ausencia con el código y cargo del tripulante que se ausentó.
const absenceWithCrewMember = `
  SELECT a.id, a.crew_user_id, a.flight_id, a.flight_number,
         a.flight_departure_at, a.reason, a.notes, a.status,
         a.replacement_user_id, a.covered_at, a.created_at,
         c.employee_code, c.position
  FROM public.absences a
  LEFT JOIN public.crew_members c ON c.user_id = a.crew_user_id`;

async function createAbsence({
  crewUserId,
  flightId,
  flightNumber,
  flightDepartureAt,
  reason,
  notes,
}) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.absences
         (crew_user_id, flight_id, flight_number, flight_departure_at, reason, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${absenceColumns}`,
      [crewUserId, flightId, flightNumber, flightDepartureAt, reason, notes]
    );

    return rows[0];
  } catch (cause) {
    if (cause.code === '23505') {
      const error = new Error('Ya reportaste una ausencia para este vuelo.');
      error.status = 409;
      throw error;
    }

    throw cause;
  }
}

// Las más recientes primero; `status` es opcional.
async function findAbsences({ status = null } = {}) {
  const { rows } = await pool.query(
    `${absenceWithCrewMember}
     WHERE ($1::text IS NULL OR a.status = $1)
     ORDER BY a.created_at DESC`,
    [status]
  );

  return rows;
}

async function findAbsenceById(id) {
  const { rows } = await pool.query(
    `${absenceWithCrewMember}
     WHERE a.id = $1`,
    [id]
  );

  return rows[0] || null;
}

// Solo cambia una ausencia que siga `reported`; si otra petición la cubrió
// primero, devuelve null.
async function markAbsenceCovered(id, replacementUserId) {
  const { rows } = await pool.query(
    `UPDATE public.absences
     SET status = 'covered', replacement_user_id = $2, covered_at = now()
     WHERE id = $1 AND status = 'reported'
     RETURNING ${absenceColumns}`,
    [id, replacementUserId]
  );

  return rows[0] || null;
}

module.exports = {
  createAbsence,
  findAbsences,
  findAbsenceById,
  markAbsenceCovered,
};
