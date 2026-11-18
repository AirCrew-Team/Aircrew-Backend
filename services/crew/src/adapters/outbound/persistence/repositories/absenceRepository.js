const pool = require('../pool');

const absenceColumns = `id, crew_user_id, flight_id, flight_number,
       flight_departure_at, reason, notes, status, created_at`;

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

// Ausencias con el código y cargo del tripulante, las más recientes primero.
async function findAbsences() {
  const { rows } = await pool.query(
    `SELECT a.id, a.crew_user_id, a.flight_id, a.flight_number,
            a.flight_departure_at, a.reason, a.notes, a.status, a.created_at,
            c.employee_code, c.position
     FROM public.absences a
     LEFT JOIN public.crew_members c ON c.user_id = a.crew_user_id
     ORDER BY a.created_at DESC`
  );

  return rows;
}

module.exports = { createAbsence, findAbsences };
