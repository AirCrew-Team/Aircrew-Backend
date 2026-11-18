const pool = require('../pool');

async function createAircraft({
  name,
  registration,
  capacity,
  minimumCrew,
  initialDestination,
  finalDestination,
  status,
}) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.aircraft
         (name, registration, capacity, minimum_crew, initial_destination,
          final_destination, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, registration, capacity, minimum_crew,
                 initial_destination, final_destination, status,
                 created_at, updated_at`,
      [
        name,
        registration,
        capacity,
        minimumCrew,
        initialDestination,
        finalDestination,
        status,
      ]
    );

    return rows[0];
  } catch (cause) {
    if (cause.code === '23505') {
      const error = new Error('Ya existe una aeronave con esa matrícula.');
      error.status = 409;
      throw error;
    }

    throw cause;
  }
}

// Todas las aeronaves; `status` es opcional.
async function findAircraft({ status = null } = {}) {
  const { rows } = await pool.query(
    `SELECT id, name, registration, capacity, minimum_crew,
            initial_destination, final_destination, status
     FROM public.aircraft
     WHERE ($1::text IS NULL OR status = $1)
     ORDER BY registration`,
    [status]
  );

  return rows;
}

async function findOperatingAircraft() {
  const { rows } = await pool.query(
    `SELECT
       id,
       name,
       registration,
       capacity,
       minimum_crew,
       initial_destination,
       final_destination,
       status
     FROM public.aircraft
     WHERE status = 'operating'
     ORDER BY registration`
  );

  return rows;
}

async function getAircraftStatusSummary() {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'operating')::int AS operating,
       COUNT(*) FILTER (WHERE status = 'maintenance')::int AS maintenance,
       COUNT(*) FILTER (WHERE status = 'inactive')::int AS inactive
     FROM public.aircraft`
  );

  return rows[0];
}

async function findAircraftById(id) {
  const { rows } = await pool.query(
    `SELECT id, name, registration, status
     FROM public.aircraft
     WHERE id = $1`,
    [id]
  );

  return rows[0] || null;
}

module.exports = {
  findAircraft,
  createAircraft,
  findOperatingAircraft,
  getAircraftStatusSummary,
  findAircraftById,
};
