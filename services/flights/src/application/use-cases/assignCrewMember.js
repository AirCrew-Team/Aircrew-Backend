const {
  createAssignment,
  canAssignCrewTo,
  findConflictingFlight,
} = require('../../domain/entities/assignment');
const { isValidFlightId } = require('../../domain/entities/flight');
const { DomainError } = require('../../domain/errors');

function createAssignCrewMember({ flightRepository, assignmentRepository }) {
  return async function assignCrewMember(flightId, input) {
    const { crew_user_id: crewUserId, role } = input || {};
    const assignment = createAssignment({ flightId, crewUserId, role });

    const flight = isValidFlightId(flightId)
      ? await flightRepository.findFlightById(flightId)
      : null;

    if (!flight) {
      throw new DomainError('Vuelo no encontrado.', 404);
    }

    if (!canAssignCrewTo(flight)) {
      throw new DomainError(
        'Solo se puede asignar tripulación a vuelos programados o demorados.',
        409
      );
    }

    const otherFlights =
      await assignmentRepository.findActiveFlightsByCrewUser(crewUserId);
    const conflict = findConflictingFlight(otherFlights, flight);

    if (conflict) {
      throw new DomainError(
        `El tripulante ya tiene el vuelo ${conflict.flight_number} en ese horario.`,
        409
      );
    }

    return assignmentRepository.createAssignment(assignment);
  };
}

module.exports = createAssignCrewMember;
