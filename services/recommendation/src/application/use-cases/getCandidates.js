const { requiredPositionFor } = require('../../domain/rules/qualificationRule');
const { rankCandidates } = require('../../domain/services/recommendationEngine');
const { DomainError } = require('../../domain/errors');

function absentNotAssignedError() {
  return new DomainError(
    'El tripulante ausente ya no tiene asignación activa en este vuelo.',
    409
  );
}

function toFlightSummary(flight) {
  return {
    id: flight.id,
    flight_number: flight.flight_number,
    origin: flight.origin,
    destination: flight.destination,
    departure_at: flight.departure_at,
    arrival_at: flight.arrival_at,
  };
}

// Calcula los candidatos para cubrir una ausencia con datos frescos de
// Crew y Flights. No guarda nada.
function createGetCandidates({ loadReplacementContext }) {
  return async function getCandidates(absenceId, authorization) {
    const { absence, flight, members, assignments, findOnFlight } =
      await loadReplacementContext(absenceId, authorization);

    const absentAssignment = findOnFlight(absence.crew_user_id);

    if (!absentAssignment) {
      throw absentNotAssignedError();
    }

    const { role } = absentAssignment;
    const { candidates, discarded } = rankCandidates({
      members,
      flight,
      role,
      absentUserId: absence.crew_user_id,
      assignments,
    });

    return {
      absence: {
        id: absence.id,
        crew_user_id: absence.crew_user_id,
        employee_code: absence.employee_code,
        reason: absence.reason,
        status: absence.status,
      },
      flight: toFlightSummary(flight),
      role,
      required_position: requiredPositionFor(role),
      candidates,
      discarded,
    };
  };
}

module.exports = createGetCandidates;
module.exports.absentNotAssignedError = absentNotAssignedError;
module.exports.toFlightSummary = toFlightSummary;
