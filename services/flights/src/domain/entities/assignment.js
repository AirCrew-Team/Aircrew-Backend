const { DomainError } = require('../errors');

// captain: capitán · first_officer: primer oficial
// purser: jefe de cabina · flight_attendant: auxiliar de vuelo
const CREW_ROLES = ['captain', 'first_officer', 'purser', 'flight_attendant'];

// Solo se puede asignar tripulación a vuelos que todavía no despegan.
const ASSIGNABLE_FLIGHT_STATUSES = ['scheduled', 'delayed'];

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Valida y normaliza los datos de una asignación nueva.
function createAssignment({ flightId, crewUserId, role }) {
  if (typeof crewUserId !== 'string' || !uuidPattern.test(crewUserId)) {
    throw new DomainError('Se requiere un crew_user_id válido.');
  }

  if (!CREW_ROLES.includes(role)) {
    throw new DomainError(`role debe ser uno de: ${CREW_ROLES.join(', ')}.`);
  }

  return { flightId, crewUserId, role };
}

function canAssignCrewTo(flight) {
  return ASSIGNABLE_FLIGHT_STATUSES.includes(flight.status);
}

// Dos vuelos se cruzan si uno sale antes de que el otro llegue.
function flightsOverlap(a, b) {
  return (
    new Date(a.departure_at) < new Date(b.arrival_at) &&
    new Date(b.departure_at) < new Date(a.arrival_at)
  );
}

// El primer vuelo de `otherFlights` que se cruza con `flight`, si hay alguno.
function findConflictingFlight(otherFlights, flight) {
  return otherFlights.find(
    (other) => other.id !== flight.id && flightsOverlap(other, flight)
  );
}

// Valida los datos para cambiar a un tripulante por otro en un vuelo.
function createReplacement({ replacedCrewUserId, crewUserId }) {
  if (
    typeof replacedCrewUserId !== 'string' ||
    !uuidPattern.test(replacedCrewUserId) ||
    typeof crewUserId !== 'string' ||
    !uuidPattern.test(crewUserId)
  ) {
    throw new DomainError(
      'Se requieren un replaced_crew_user_id y un crew_user_id válidos.'
    );
  }

  if (replacedCrewUserId.toLowerCase() === crewUserId.toLowerCase()) {
    throw new DomainError(
      'El reemplazo debe ser un tripulante distinto al reemplazado.'
    );
  }

  return { replacedCrewUserId, crewUserId };
}

module.exports = {
  CREW_ROLES,
  createAssignment,
  canAssignCrewTo,
  flightsOverlap,
  findConflictingFlight,
  createReplacement,
};
