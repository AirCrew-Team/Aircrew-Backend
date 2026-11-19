const pool = require('../pool');

const absenceColumns = `id, crew_user_id, flight_id, flight_number,
       flight_departure_at, flight_origin, flight_destination, slot_role,
       reason, notes, status, suggestions_state, replacement_user_id,
       approved_by, approved_at, deadline_at, covered_at, created_at`;

// Ausencia con el código, cargo y rango del tripulante que se ausentó.
const absenceWithCrewMember = `
  SELECT a.id, a.crew_user_id, a.flight_id, a.flight_number,
         a.flight_departure_at, a.flight_origin, a.flight_destination,
         a.slot_role, a.reason, a.notes, a.status, a.suggestions_state,
         a.replacement_user_id, a.approved_by, a.approved_at, a.deadline_at,
         a.covered_at, a.created_at,
         c.employee_code, c.position, c.rank
  FROM public.absences a
  LEFT JOIN public.crew_members c ON c.user_id = a.crew_user_id`;

async function createAbsence({
  crewUserId,
  flightId,
  flightNumber,
  flightDepartureAt,
  flightOrigin,
  flightDestination,
  slotRole,
  reason,
  notes,
}) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.absences
         (crew_user_id, flight_id, flight_number, flight_departure_at,
          flight_origin, flight_destination, slot_role, reason, notes,
          suggestions_state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'searching')
       RETURNING ${absenceColumns}`,
      [
        crewUserId,
        flightId,
        flightNumber,
        flightDepartureAt,
        flightOrigin,
        flightDestination,
        slotRole,
        reason,
        notes,
      ]
    );

    return rows[0];
  } catch (cause) {
    if (cause.code === '23505') {
      const error = new Error('Ya reportaste una ausencia para este vuelo.');
      error.status = 409;
      error.code = 'duplicate_absence';
      throw error;
    }

    throw cause;
  }
}

// Con filtro de estado, ordenadas por la salida más próxima (la cola de
// solicitudes). Sin filtro, las más recientes primero.
async function findAbsences({ status = null } = {}) {
  const { rows } = await pool.query(
    `${absenceWithCrewMember}
     WHERE ($1::text IS NULL OR a.status = $1)
     ORDER BY CASE WHEN $1::text IS NULL THEN NULL ELSE a.flight_departure_at END ASC,
              a.created_at DESC`,
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

async function updateSuggestionsState(id, state) {
  const { rows } = await pool.query(
    `UPDATE public.absences SET suggestions_state = $2
     WHERE id = $1
     RETURNING ${absenceColumns}`,
    [id, state]
  );

  return rows[0] || null;
}

// Línea de tiempo de la ausencia.
async function addAbsenceEvent(absenceId, type, text) {
  await pool.query(
    `INSERT INTO public.absence_events (absence_id, type, text) VALUES ($1, $2, $3)`,
    [absenceId, type, text]
  );
}

async function findAbsenceEvents(absenceId) {
  const { rows } = await pool.query(
    `SELECT type, text, created_at AS at
     FROM public.absence_events
     WHERE absence_id = $1
     ORDER BY created_at`,
    [absenceId]
  );

  return rows;
}

module.exports = {
  createAbsence,
  findAbsences,
  findAbsenceById,
  markAbsenceCovered,
  updateSuggestionsState,
  addAbsenceEvent,
  findAbsenceEvents,
};
