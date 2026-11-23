const pool = require('../pool');

const flightColumns = `id, flight_number, aircraft_id, origin, destination,
       departure_at, arrival_at, status, gate, created_at, updated_at`;

// Día UTC (AAAA-MM-DD) de una salida: la llave del número de vuelo único por día.
const utcDay = (instant) => new Date(instant).toISOString().slice(0, 10);

async function createFlight({
  flightNumber,
  aircraftId,
  origin,
  destination,
  departureAt,
  arrivalAt,
  status,
  gate = null,
}) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.flights
         (flight_number, aircraft_id, origin, destination, departure_at,
          arrival_at, status, gate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${flightColumns}`,
      [
        flightNumber,
        aircraftId,
        origin,
        destination,
        departureAt,
        arrivalAt,
        status,
        gate,
      ]
    );

    return rows[0];
  } catch (cause) {
    if (cause.code === '23505') {
      const error = new Error(`Ya existe el vuelo ${flightNumber} el ${utcDay(departureAt)}.`);
      error.status = 409;
      throw error;
    }

    throw cause;
  }
}

// Vuelo con los datos que usan la programación y las reglas: familia y sillas
// del avión, ciudades, y si es internacional. Doméstico solo si los dos aeropuertos
// están en public.airports con country 'US': uno desconocido cuenta como internacional.
const flightDetail = `
  SELECT f.id, f.flight_number, f.aircraft_id, f.origin, f.destination,
         f.departure_at, f.arrival_at, f.status, f.gate, f.crew_confirmed_at,
         f.created_at, f.updated_at,
         ac.family AS aircraft_family, ac.capacity AS aircraft_seats,
         ac.name AS aircraft_name, ac.registration AS aircraft_registration,
         o.city AS origin_city, d.city AS destination_city,
         o.name AS origin_name, d.name AS destination_name,
         o.timezone AS origin_timezone, d.timezone AS destination_timezone,
         CASE WHEN o.country IS NOT DISTINCT FROM 'US' AND d.country IS NOT DISTINCT FROM 'US'
              THEN 'domestic' ELSE 'international' END AS scope
  FROM public.flights f
  JOIN public.aircraft ac ON ac.id = f.aircraft_id
  LEFT JOIN public.airports o ON o.code = f.origin
  LEFT JOIN public.airports d ON d.code = f.destination`;

async function findFlights({ from, to, ids = null }) {
  const { rows } = await pool.query(
    `${flightDetail}
     WHERE ($1::timestamptz IS NULL OR f.departure_at >= $1)
       AND ($2::timestamptz IS NULL OR f.departure_at < $2)
       AND ($3::uuid[] IS NULL OR f.id = ANY($3::uuid[]))
     ORDER BY f.departure_at`,
    [from, to, ids]
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

// ---------- Catálogo y pantalla del super_admin ----------

async function findAllAirports() {
  const { rows } = await pool.query(
    `SELECT code, icao, city, name, country, timezone FROM public.airports ORDER BY city, code`
  );
  return rows;
}

async function findAirportsByCodes(codes) {
  const { rows } = await pool.query(
    `SELECT code, icao, city, name, country, timezone FROM public.airports WHERE code = ANY($1::text[])`,
    [codes]
  );
  return rows;
}

// Otro vuelo con ese número el mismo día UTC de la salida.
async function findFlightByNumberOnDay(flightNumber, departureAt) {
  const { rows } = await pool.query(
    `SELECT id FROM public.flights
     WHERE flight_number = $1
       AND (departure_at AT TIME ZONE 'UTC')::date = ($2::timestamptz AT TIME ZONE 'UTC')::date
     LIMIT 1`,
    [flightNumber, departureAt]
  );
  return rows[0] || null;
}

// Vuelo no cancelado de la aeronave cuyo horario se cruza con [departureAt, arrivalAt).
async function findOverlappingFlight(aircraftId, departureAt, arrivalAt) {
  const { rows } = await pool.query(
    `SELECT f.id, f.flight_number, f.departure_at, f.arrival_at,
            ac.registration AS aircraft_registration, o.timezone AS origin_timezone
     FROM public.flights f
     JOIN public.aircraft ac ON ac.id = f.aircraft_id
     LEFT JOIN public.airports o ON o.code = f.origin
     WHERE f.aircraft_id = $1 AND f.status <> 'cancelled'
       AND f.departure_at < $3 AND f.arrival_at > $2
     ORDER BY f.departure_at
     LIMIT 1`,
    [aircraftId, departureAt, arrivalAt]
  );
  return rows[0] || null;
}

// Texto sin mayúsculas ni tildes, igual que normalizeSearch del caso de uso.
const plain = (column) => `translate(lower(${column}), 'áéíóúüñ', 'aeiouun')`;

// Tabla del admin: búsqueda por número, origen, destino (código o ciudad) o matrícula.
async function findFlightsPage({ search = null, status = null, from = null, to = null, limit, offset }) {
  const where = `
     WHERE ($1::text IS NULL OR ${plain('f.flight_number')} LIKE $1 OR ${plain('f.origin')} LIKE $1
            OR ${plain('f.destination')} LIKE $1 OR ${plain('ac.registration')} LIKE $1
            OR ${plain("coalesce(o.city, '')")} LIKE $1 OR ${plain("coalesce(d.city, '')")} LIKE $1)
       AND ($2::text IS NULL OR f.status = $2)
       AND ($3::timestamptz IS NULL OR f.departure_at >= $3)
       AND ($4::timestamptz IS NULL OR f.departure_at < $4)`;
  const params = [search ? `%${search}%` : null, status, from, to];

  const [page, count] = await Promise.all([
    pool.query(`${flightDetail} ${where} ORDER BY f.departure_at, f.flight_number LIMIT $5 OFFSET $6`, [
      ...params,
      limit,
      offset,
    ]),
    pool.query(
      `SELECT count(*)::int AS total
       FROM public.flights f
       JOIN public.aircraft ac ON ac.id = f.aircraft_id
       LEFT JOIN public.airports o ON o.code = f.origin
       LEFT JOIN public.airports d ON d.code = f.destination
       ${where}`,
      params
    ),
  ]);

  return { rows: page.rows, total: count.rows[0].total };
}

// Indicadores: totales por estado y vuelos que salen en [todayFrom, todayTo).
async function countFlights({ todayFrom, todayTo }) {
  const { rows } = await pool.query(
    `SELECT status, count(*)::int AS total,
            count(*) FILTER (WHERE departure_at >= $1 AND departure_at < $2)::int AS today
     FROM public.flights GROUP BY status`,
    [todayFrom, todayTo]
  );
  return rows;
}

// Vuelos que todavía necesitan tripulación (ni cancelados ni completados).
async function findOpenFlights() {
  const { rows } = await pool.query(
    `${flightDetail} WHERE f.status NOT IN ('cancelled', 'completed') ORDER BY f.departure_at`
  );
  return rows;
}

module.exports = {
  createFlight,
  findFlights,
  findFlightById,
  confirmFlightCrew,
  findAllAirports,
  findAirportsByCodes,
  findFlightByNumberOnDay,
  findOverlappingFlight,
  findFlightsPage,
  countFlights,
  findOpenFlights,
};
