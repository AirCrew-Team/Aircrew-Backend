const {
  canAssignCrewTo,
  createReplacement,
  findConflictingFlight,
} = require('../../domain/entities/assignment');
const { isValidFlightId } = require('../../domain/entities/flight');
const { DomainError } = require('../../domain/errors');

// Cambia a un tripulante por otro en un vuelo. El reemplazo hereda el rol a bordo.
function createReplaceCrewMember({ flightRepository, assignmentRepository }) {
  return async function replaceCrewMember(flightId, input) {
    const { replaced_crew_user_id: replacedCrewUserId, crew_user_id: crewUserId } =
      input || {};
    const replacement = createReplacement({ replacedCrewUserId, crewUserId });

    const flight = isValidFlightId(flightId)
      ? await flightRepository.findFlightById(flightId)
      : null;

    if (!flight) {
      throw new DomainError('Vuelo no encontrado.', 404);
    }

    if (!canAssignCrewTo(flight)) {
      throw new DomainError(
        'Solo se puede reemplazar tripulación en vuelos programados o demorados.',
        409
      );
    }

    const current = await assignmentRepository.findActiveAssignment(
      flight.id,
      replacement.replacedCrewUserId
    );

    if (!current) {
      throw new DomainError(
        'El tripulante a reemplazar no tiene una asignación activa en este vuelo.',
        404
      );
    }

    const otherFlights = await assignmentRepository.findActiveFlightsByCrewUser(
      replacement.crewUserId
    );
    const conflict = findConflictingFlight(otherFlights, flight);

    if (conflict) {
      throw new DomainError(
        `El reemplazo ya tiene el vuelo ${conflict.flight_number} en ese horario.`,
        409
      );
    }

    return assignmentRepository.replaceAssignment({
      assignmentId: current.id,
      flightId: flight.id,
      crewUserId: replacement.crewUserId,
      role: current.role,
    });
  };
}

module.exports = createReplaceCrewMember;
