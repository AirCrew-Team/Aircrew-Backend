const { DomainError } = require('../errors');
const { parseInstant } = require('../value-objects/instant');

const FLIGHT_STATUSES = [
  'scheduled',
  'delayed',
  'in_flight',
  'completed',
  'cancelled',
];
const FLIGHT_STATUS_LABELS = Object.freeze({
  scheduled: 'Programado',
  delayed: 'Retrasado',
  in_flight: 'En vuelo',
  completed: 'Completado',
  cancelled: 'Cancelado',
});
// Código de la aerolínea (2 caracteres) y de 1 a 4 números: DL1234, AV9.
const flightNumberPattern = /^[A-Z0-9]{2}\d{1,4}$/;
const MAX_DURATION_HOURS = 20;
const MAX_GATE_LENGTH = 5;
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
  gate = null,
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

  const normalizedNumber = flightNumber.trim().toUpperCase();

  if (!flightNumberPattern.test(normalizedNumber)) {
    throw new DomainError('Usa el código de la aerolínea y de 1 a 4 números (ej. DL1234).', 400, {
      field: 'flight_number',
    });
  }

  const normalizedOrigin = origin.trim().toUpperCase();
  const normalizedDestination = destination.trim().toUpperCase();

  if (normalizedOrigin === normalizedDestination) {
    throw new DomainError('El origen y el destino deben ser distintos.');
  }

  if (arrival <= departure || arrival - departure > MAX_DURATION_HOURS * 3600000) {
    throw new DomainError(
      `La llegada debe ser después de la salida y el vuelo durar máximo ${MAX_DURATION_HOURS} h.`,
      400,
      { field: 'arrival_at' }
    );
  }

  const normalizedGate = normalizeGate(gate);

  return {
    flightNumber: normalizedNumber,
    aircraftId,
    origin: normalizedOrigin,
    destination: normalizedDestination,
    departureAt: departure.toISOString(),
    arrivalAt: arrival.toISOString(),
    status,
    gate: normalizedGate,
  };
}

// gate: texto corto (hasta 5 caracteres) o null.
function normalizeGate(gate) {
  if (gate === undefined || gate === null) return null;
  const value = typeof gate === 'string' ? gate.trim().toUpperCase() : null;
  if (value === '') return null;
  if (value === null || value.length > MAX_GATE_LENGTH) {
    throw new DomainError(`La puerta (gate) debe tener máximo ${MAX_GATE_LENGTH} caracteres.`, 400, {
      field: 'gate',
    });
  }
  return value;
}

function isValidFlightId(id) {
  return typeof id === 'string' && uuidPattern.test(id);
}

module.exports = { FLIGHT_STATUSES, FLIGHT_STATUS_LABELS, createFlight, isValidFlightId };
