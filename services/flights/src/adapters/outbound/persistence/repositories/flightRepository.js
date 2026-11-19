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

// Vuelo con los datos que usan la programación y las reglas: familia y sillas
// del avión, ciudades, y si es internacional (algún aeropuerto fuera de Colombia).
const flightDetail = `
  SELECT f.id, f.flight_number, f.aircraft_id, f.origin, f.destination,
         f.departure_at, f.arrival_at, f.status, f.gate, f.crew_confirmed_at,
         f.created_at, f.updated_at,
         ac.family AS aircraft_family, ac.capacity AS aircraft_seats,
         ac.name AS aircraft_name, ac.registration AS aircraft_registration,
         o.city AS origin_city, d.city AS destination_city,
         CASE WHEN COALESCE(o.country, 'CO') <> 'CO' OR COALESCE(d.country, 'CO') <> 'CO'
              THEN 'international' ELSE 'domestic' END AS scope
  FROM public.flights f
  JOIN public.aircraft ac ON ac.id = f.aircraft_id
  LEFT JOIN public.airports o ON o.code = f.origin
  LEFT JOIN public.airports d ON d.code = f.destination`;

async function findFlights({ from, to }) {
  const { rows } = await pool.query(
    `${flightDetail}
     WHERE ($1::timestamptz IS NULL OR f.departure_at >= $1)
       AND ($2::timestamptz IS NULL OR f.departure_at < $2)
     ORDER BY f.departure_at`,
    [from, to]
  );

  return rows;
}

// El supervisor confirmó la tripulación: ya no se edita.
async function confirmFlightCrew(id, userId) {
  const { rows } = await pool.query(
    `UPDATE public.flights SET crew_confirmed_at = now(), crew_confirmed_by = $2, updated_at = now()
     WHERE id = $1 AND crew_confirmed_at IS NULL
     RETURNING id`,
    [id, userId]
  );

  return rows[0] || null;
}

async function findFlightById(id) {
  const { rows } = await pool.query(`${flightDetail} WHERE f.id = $1`, [id]);
  return rows[0] || null;
}

module.exports = { createFlight, findFlights, findFlightById, confirmFlightCrew };
