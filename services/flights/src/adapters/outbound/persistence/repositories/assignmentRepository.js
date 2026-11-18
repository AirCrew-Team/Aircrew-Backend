const pool = require('../pool');

// Asignación junto con su vuelo y aeronave, como la necesita el frontend.
const assignmentWithFlight = `
  SELECT a.id, a.crew_user_id, a.role, a.status, a.created_at,
         f.id AS flight_id, f.flight_number, f.origin, f.destination,
         f.departure_at, f.arrival_at, f.status AS flight_status,
         ac.id AS aircraft_id, ac.name AS aircraft_name,
         ac.registration AS aircraft_registration
  FROM public.flight_assignments a
  JOIN public.flights f ON f.id = a.flight_id
  JOIN public.aircraft ac ON ac.id = f.aircraft_id`;

// Arma el objeto en JS para que las fechas salgan en el mismo formato
// (ISO en UTC con Z) que el resto de la API.
function toAssignmentWithFlight(row) {
  return {
    id: row.id,
    role: row.role,
    status: row.status,
    created_at: row.created_at,
    flight: {
      id: row.flight_id,
      flight_number: row.flight_number,
      origin: row.origin,
      destination: row.destination,
      departure_at: row.departure_at,
      arrival_at: row.arrival_at,
      status: row.flight_status,
    },
    aircraft: {
      id: row.aircraft_id,
      name: row.aircraft_name,
      registration: row.aircraft_registration,
    },
  };
}

const assignmentColumns = 'id, flight_id, crew_user_id, role, status, created_at';

function duplicateAssignmentError() {
  const error = new Error('El tripulante ya está asignado a este vuelo.');
  error.status = 409;
  return error;
}

async function createAssignment({ flightId, crewUserId, role }) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.flight_assignments (flight_id, crew_user_id, role)
       VALUES ($1, $2, $3)
       RETURNING ${assignmentColumns}`,
      [flightId, crewUserId, role]
    );

    return rows[0];
  } catch (cause) {
    if (cause.code === '23505') {
      throw duplicateAssignmentError();
    }

    throw cause;
  }
}

async function findActiveAssignment(flightId, crewUserId) {
  const { rows } = await pool.query(
    `SELECT ${assignmentColumns}
     FROM public.flight_assignments
     WHERE flight_id = $1 AND crew_user_id = $2 AND status = 'assigned'`,
    [flightId, crewUserId]
  );

  return rows[0] || null;
}

// Marca la asignación vieja como `replaced` y crea la nueva en una sola
// transacción: o quedan los dos cambios, o no queda ninguno.
async function replaceAssignment({ assignmentId, flightId, crewUserId, role }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const replaced = await client.query(
      `UPDATE public.flight_assignments
       SET status = 'replaced'
       WHERE id = $1 AND status = 'assigned'
       RETURNING ${assignmentColumns}`,
      [assignmentId]
    );

    if (!replaced.rows[0]) {
      const error = new Error('Esa asignación ya fue reemplazada.');
      error.status = 409;
      throw error;
    }

    const created = await client.query(
      `INSERT INTO public.flight_assignments (flight_id, crew_user_id, role)
       VALUES ($1, $2, $3)
       RETURNING ${assignmentColumns}`,
      [flightId, crewUserId, role]
    );

    await client.query('COMMIT');

    return { replaced: replaced.rows[0], assignment: created.rows[0] };
  } catch (cause) {
    await client.query('ROLLBACK');

    if (cause.code === '23505') {
      throw duplicateAssignmentError();
    }

    throw cause;
  } finally {
    client.release();
  }
}

// Asignaciones activas cuyos vuelos se cruzan con [from, to).
async function findAssignmentsInRange({ from, to }) {
  const { rows } = await pool.query(
    `${assignmentWithFlight}
     WHERE a.status = 'assigned'
       AND f.status NOT IN ('completed', 'cancelled')
       AND f.departure_at < $2
       AND f.arrival_at > $1
     ORDER BY f.departure_at`,
    [from, to]
  );

  return rows.map((row) => ({
    crew_user_id: row.crew_user_id,
    ...toAssignmentWithFlight(row),
  }));
}

// Vuelos activos del tripulante, para revisar que no se crucen.
async function findActiveFlightsByCrewUser(crewUserId) {
  const { rows } = await pool.query(
    `SELECT f.id, f.flight_number, f.departure_at, f.arrival_at
     FROM public.flight_assignments a
     JOIN public.flights f ON f.id = a.flight_id
     WHERE a.crew_user_id = $1
       AND a.status = 'assigned'
       AND f.status NOT IN ('completed', 'cancelled')`,
    [crewUserId]
  );

  return rows;
}

async function findAssignmentsByCrewUser(crewUserId) {
  const { rows } = await pool.query(
    `${assignmentWithFlight}
     WHERE a.crew_user_id = $1 AND a.status = 'assigned'
     ORDER BY f.departure_at`,
    [crewUserId]
  );

  return rows.map(toAssignmentWithFlight);
}

async function findNextAssignmentByCrewUser(crewUserId, now) {
  const { rows } = await pool.query(
    `${assignmentWithFlight}
     WHERE a.crew_user_id = $1
       AND a.status = 'assigned'
       AND f.status IN ('scheduled', 'delayed')
       AND f.departure_at > $2
     ORDER BY f.departure_at
     LIMIT 1`,
    [crewUserId, now]
  );

  return rows[0] ? toAssignmentWithFlight(rows[0]) : null;
}

module.exports = {
  createAssignment,
  findActiveAssignment,
  replaceAssignment,
  findAssignmentsInRange,
  findActiveFlightsByCrewUser,
  findAssignmentsByCrewUser,
  findNextAssignmentByCrewUser,
};
