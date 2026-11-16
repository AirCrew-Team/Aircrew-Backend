const pool = require('../pool');

// Asignación junto con su vuelo y aeronave, como la necesita el frontend.
const assignmentWithFlight = `
  SELECT a.id, a.role, a.status, a.created_at,
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

async function createAssignment({ flightId, crewUserId, role }) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.flight_assignments (flight_id, crew_user_id, role)
       VALUES ($1, $2, $3)
       RETURNING id, flight_id, crew_user_id, role, status, created_at`,
      [flightId, crewUserId, role]
    );

    return rows[0];
  } catch (cause) {
    if (cause.code === '23505') {
      const error = new Error('El tripulante ya está asignado a este vuelo.');
      error.status = 409;
      throw error;
    }

    throw cause;
  }
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
  findActiveFlightsByCrewUser,
  findAssignmentsByCrewUser,
  findNextAssignmentByCrewUser,
};
