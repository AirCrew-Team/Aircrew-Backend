const pool = require('../pool');

const flightColumns = `id, flight_number, aircraft_id, origin, destination,
       departure_at, arrival_at, status, created_at, updated_at`;

async function createFlight({
  flightNumber,
  aircraftId,
  origin,
  destination,
  departureAt,
  arrivalAt,
  status,
}) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.flights
         (flight_number, aircraft_id, origin, destination, departure_at,
          arrival_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${flightColumns}`,
      [
        flightNumber,
        aircraftId,
        origin,
        destination,
        departureAt,
        arrivalAt,
        status,
      ]
    );

    return rows[0];
  } catch (cause) {
    if (cause.code === '23505') {
      const error = new Error('Ya existe un vuelo con ese flight_number.');
      error.status = 409;
      throw error;
    }

    throw cause;
  }
}

async function findFlights({ from, to }) {
  const { rows } = await pool.query(
    `SELECT ${flightColumns}
     FROM public.flights
     WHERE ($1::timestamptz IS NULL OR departure_at >= $1)
       AND ($2::timestamptz IS NULL OR departure_at < $2)
     ORDER BY departure_at`,
    [from, to]
  );

  return rows;
}

// Vuelo con los datos que usan las reglas de elegibilidad: familia y sillas
// del avión, y si es internacional (algún aeropuerto fuera de Colombia).
async function findFlightById(id) {
  const { rows } = await pool.query(
    `SELECT f.id, f.flight_number, f.aircraft_id, f.origin, f.destination,
            f.departure_at, f.arrival_at, f.status, f.gate, f.crew_confirmed_at,
            f.created_at, f.updated_at,
            ac.family AS aircraft_family, ac.capacity AS aircraft_seats,
            ac.name AS aircraft_name, ac.registration AS aircraft_registration,
            CASE WHEN COALESCE(o.country, 'CO') <> 'CO' OR COALESCE(d.country, 'CO') <> 'CO'
                 THEN 'international' ELSE 'domestic' END AS scope
     FROM public.flights f
     JOIN public.aircraft ac ON ac.id = f.aircraft_id
     LEFT JOIN public.airports o ON o.code = f.origin
     LEFT JOIN public.airports d ON d.code = f.destination
     WHERE f.id = $1`,
    [id]
  );

  return rows[0] || null;
}

module.exports = { createFlight, findFlights, findFlightById };
