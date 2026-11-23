const { HUBS, DEFAULT_TIMEZONE, localDate, localDayRange } = require('@vuelos/shared');
const { FLIGHT_STATUSES, FLIGHT_STATUS_LABELS } = require('../../domain/entities/flight');
const { requiredSlots, crewStatus } = require('../../domain/entities/crewComplement');
const { DomainError } = require('../../domain/errors');

const DEFAULT_PAGE_SIZE = 5;
const MAX_PAGE_SIZE = 100;
const BASE_CODES = new Set(HUBS.map((hub) => hub.code));

// Un vuelo de la pantalla del admin: el detalle, cuántos puestos pide y cómo va su
// tripulación. required_slots es un número (en GET /flights sigue siendo la lista).
function toFlightItem(flight, assignments = []) {
  return {
    ...flight,
    required_slots: requiredSlots(flight).length,
    crew_status: crewStatus(flight, assignments),
  };
}

// crew_status de varios vuelos con una sola consulta de asignaciones.
async function withCrewStatus(flights, assignmentRepository) {
  const assignments = await assignmentRepository.findActiveByFlights(flights.map((flight) => flight.id));
  return flights.map((flight) =>
    toFlightItem(
      flight,
      assignments.filter((item) => item.flight_id === flight.id)
    )
  );
}

// Minúsculas y sin tildes, para que «Cancún», «cancun» y «CUN» encuentren lo mismo.
// Escapa los comodines de LIKE.
function normalizeSearch(value) {
  if (typeof value !== 'string') return null;
  const text = value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  return text === '' ? null : text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

// Coordenada en grados decimales, o null si falta o no es un número.
function toCoordinate(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parsePositiveInt(value, fallback, name, max = Infinity) {
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) {
    const range = max === Infinity ? 'un entero mayor que 0' : `un entero entre 1 y ${max}`;
    throw new DomainError(`${name} debe ser ${range}.`, 400, { field: name });
  }
  return number;
}

function parseOptionalDate(value, name) {
  if (value === undefined || value === '') return null;
  const date = new Date(value);
  if (typeof value !== 'string' || Number.isNaN(date.getTime())) {
    throw new DomainError(`${name} debe ser una fecha ISO-8601.`, 400, { field: name });
  }
  return date.toISOString();
}

function createManageFlights({ flightRepository, aircraftRepository, assignmentRepository, now = () => new Date() }) {
  // Catálogo del formulario: aeropuertos, aeronaves operativas y estados.
  async function getOptions() {
    const [airports, aircraft] = await Promise.all([
      flightRepository.findAllAirports(),
      aircraftRepository.findOperatingAircraft(),
    ]);

    return {
      airports: airports.map((airport) => ({
        code: airport.code,
        icao: airport.icao,
        city: airport.city,
        name: airport.name,
        country: airport.country,
        timezone: airport.timezone,
        is_base: BASE_CODES.has(airport.code),
        // Coordenadas para estimar la duración de la ruta; null si el aeropuerto no las tiene.
        latitude: toCoordinate(airport.latitude),
        longitude: toCoordinate(airport.longitude),
      })),
      aircraft: aircraft.map((item) => ({
        id: item.id,
        registration: item.registration,
        name: item.name,
        family: item.family || null,
        capacity: item.capacity,
        base: item.base,
      })),
      statuses: FLIGHT_STATUSES.map((code) => ({ code, label: FLIGHT_STATUS_LABELS[code] })),
    };
  }

  async function listFlights(query = {}) {
    const page = parsePositiveInt(query.page, 1, 'page');
    const pageSize = parsePositiveInt(query.page_size, DEFAULT_PAGE_SIZE, 'page_size', MAX_PAGE_SIZE);
    const status = query.status === undefined || query.status === '' ? null : query.status;

    if (status !== null && !FLIGHT_STATUSES.includes(status)) {
      throw new DomainError(`status debe ser uno de: ${FLIGHT_STATUSES.join(', ')}.`, 400, { field: 'status' });
    }

    const { rows, total } = await flightRepository.findFlightsPage({
      search: normalizeSearch(query.search),
      status,
      from: parseOptionalDate(query.from, 'from'),
      to: parseOptionalDate(query.to, 'to'),
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    return { items: await withCrewStatus(rows, assignmentRepository), page, page_size: pageSize, total };
  }

  // today: vuelos que salen hoy en la zona de operaciones (DEFAULT_TIMEZONE) ·
  // without_crew: vuelos abiertos (ni cancelados ni completados) sin tripulación o incompletos.
  async function getStats() {
    const today = localDayRange(localDate(now(), DEFAULT_TIMEZONE), DEFAULT_TIMEZONE);
    const [counts, openFlights] = await Promise.all([
      flightRepository.countFlights({ todayFrom: today.from, todayTo: today.to }),
      flightRepository.findOpenFlights(),
    ]);

    const byStatus = Object.fromEntries(FLIGHT_STATUSES.map((code) => [code, 0]));
    let total = 0;
    let todayTotal = 0;
    for (const row of counts) {
      byStatus[row.status] = row.total;
      total += row.total;
      todayTotal += row.today;
    }

    const items = await withCrewStatus(openFlights, assignmentRepository);
    const withoutCrew = items.filter((item) => ['unassigned', 'incomplete'].includes(item.crew_status)).length;

    return { total, today: todayTotal, without_crew: withoutCrew, by_status: byStatus };
  }

  return { getOptions, listFlights, getStats };
}

module.exports = { createManageFlights, toFlightItem, normalizeSearch };
