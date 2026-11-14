const { DomainError } = require('../errors');
const { parseInstant } = require('../value-objects/instant');

const FLIGHT_STATUSES = [
  'scheduled',
  'delayed',
  'in_flight',
  'completed',
  'cancelled',
];
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

// Valida y normaliza los datos de un vuelo nuevo. Las fechas salen en UTC.
function createFlight({
  flightNumber,
  aircraftId,
  origin,
  destination,
  departureAt,
  arrivalAt,
  status = 'scheduled',
}) {
  const departure = parseInstant(departureAt);
  const arrival = parseInstant(arrivalAt);

  if (
    !isNonEmptyString(flightNumber) ||
    typeof aircraftId !== 'string' ||
    !uuidPattern.test(aircraftId) ||
    !isNonEmptyString(origin) ||
    !isNonEmptyString(destination) ||
    !departure ||
    !arrival ||
    !FLIGHT_STATUSES.includes(status)
  ) {
    throw new DomainError(
      'Se requieren flight_number, un aircraft_id válido, origin, destination, departure_at y arrival_at (ISO-8601 con zona horaria) y un status válido.'
    );
  }

  const normalizedOrigin = origin.trim().toUpperCase();
  const normalizedDestination = destination.trim().toUpperCase();

  if (normalizedOrigin === normalizedDestination) {
    throw new DomainError('El origen y el destino deben ser distintos.');
  }

  if (arrival <= departure) {
    throw new DomainError('arrival_at debe ser posterior a departure_at.');
  }

  return {
    flightNumber: flightNumber.trim().toUpperCase(),
    aircraftId,
    origin: normalizedOrigin,
    destination: normalizedDestination,
    departureAt: departure.toISOString(),
    arrivalAt: arrival.toISOString(),
    status,
  };
}

function isValidFlightId(id) {
  return typeof id === 'string' && uuidPattern.test(id);
}

module.exports = { FLIGHT_STATUSES, createFlight, isValidFlightId };
