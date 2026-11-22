// Hubs de Delta Air Lines: la única fuente de las bases de operación.
// La usan USER_BASES (admin), AIRCRAFT_BASES (flights) y la zona horaria de
// crew y recommendation. Los scripts database/admin_db.sql (public.bases) y
// database/flights_db.sql (public.airports) siembran estos mismos valores; un
// test de cada servicio comprueba que coinciden.
//
// airport: nombre del aeropuerto (bases.name y airports.name).
// unit y hqCode: unidad y código de jefatura de la base (bases.unit, bases.hq_code).

const hub = (code, icao, city, airport, timezone, unitCity = city) =>
  Object.freeze({
    code,
    icao,
    city,
    airport,
    country: 'US',
    timezone,
    unit: `Operaciones de Vuelo ${unitCity}`,
    hqCode: `${code}-HQ`,
  });

const HUBS = Object.freeze([
  hub('ATL', 'KATL', 'Atlanta', 'Hartsfield-Jackson Atlanta International', 'America/New_York'),
  hub('BOS', 'KBOS', 'Boston', 'Boston Logan International', 'America/New_York'),
  hub('DTW', 'KDTW', 'Detroit', 'Detroit Metropolitan Wayne County', 'America/Detroit'),
  hub('LAX', 'KLAX', 'Los Ángeles', 'Los Angeles International', 'America/Los_Angeles'),
  hub('MSP', 'KMSP', 'Minneapolis-St. Paul', 'Minneapolis-Saint Paul International', 'America/Chicago', 'Minneapolis'),
  hub('JFK', 'KJFK', 'Nueva York', 'John F. Kennedy International', 'America/New_York', 'Nueva York JFK'),
  hub('LGA', 'KLGA', 'Nueva York', 'LaGuardia', 'America/New_York', 'Nueva York LaGuardia'),
  hub('SLC', 'KSLC', 'Salt Lake City', 'Salt Lake City International', 'America/Denver'),
  hub('SEA', 'KSEA', 'Seattle', 'Seattle-Tacoma International', 'America/Los_Angeles'),
]);

// Zona de quien no tiene base (p. ej. el super_admin) o de una base desconocida.
const DEFAULT_TIMEZONE = 'America/New_York';

function findHub(code) {
  if (typeof code !== 'string') return null;
  const wanted = code.toUpperCase();
  return HUBS.find((item) => item.code === wanted) || null;
}

function hubTimezone(code) {
  const found = findHub(code);
  return found ? found.timezone : DEFAULT_TIMEZONE;
}

module.exports = { HUBS, DEFAULT_TIMEZONE, findHub, hubTimezone };
