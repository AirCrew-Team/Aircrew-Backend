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
       RETURNING name, registration, capacity, minimum_crew,
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
      const error = new Error('An aircraft with this registration already exists.');
      error.status = 409;
      throw error;
    }

    throw cause;
  }
}

async function findOperatingAircraft() {
  const { rows } = await pool.query(
    `SELECT
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
       COUNT(*) FILTER (WHERE status = 'maintenance')::int AS maintenance
     FROM public.aircraft`
  );

  return rows[0];
}

module.exports = {
  createAircraft,
  findOperatingAircraft,
  getAircraftStatusSummary,
};
