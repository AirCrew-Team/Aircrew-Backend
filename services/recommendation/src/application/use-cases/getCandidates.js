const {
  isValidAbsenceId,
  assertCanBeReplaced,
} = require('../../domain/entities/replacementRequest');
const { requiredPositionFor } = require('../../domain/rules/qualificationRule');
const { rankCandidates } = require('../../domain/services/recommendationEngine');
const { LOAD_WINDOW_HOURS } = require('../../domain/services/scoring');
const { DomainError } = require('../../domain/errors');

const HOUR_MS = 60 * 60 * 1000;

// Calcula los candidatos para cubrir una ausencia con datos frescos de
// Crew y Flights. No guarda nada.
function createGetCandidates({ crewClient, flightsClient }) {
  return async function getCandidates(absenceId, authorization) {
    if (!isValidAbsenceId(absenceId)) {
      throw new DomainError('Ausencia no encontrada.', 404);
    }

    const absence = await crewClient.getAbsence(absenceId, authorization);
    const [flight, members] = await Promise.all([
      flightsClient.getFlight(absence.flight_id, authorization),
      crewClient.getCrewMembers(authorization),
    ]);

    assertCanBeReplaced(absence, flight);

    // La ventana de carga (24 h) cubre también la de descanso (10 h).
    const windowMs = LOAD_WINDOW_HOURS * HOUR_MS;
    const assignments = await flightsClient.getAssignments(
      {
        from: new Date(new Date(flight.departure_at).getTime() - windowMs).toISOString(),
        to: new Date(new Date(flight.arrival_at).getTime() + windowMs).toISOString(),
      },
      authorization
    );

    const absentAssignment = assignments.find(
      (item) =>
        item.flight.id === flight.id &&
        item.crew_user_id === absence.crew_user_id
    );

    if (!absentAssignment) {
      throw new DomainError(
        'El tripulante ausente ya no tiene asignación activa en este vuelo.',
        409
      );
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
      flight: {
        id: flight.id,
        flight_number: flight.flight_number,
        origin: flight.origin,
        destination: flight.destination,
        departure_at: flight.departure_at,
        arrival_at: flight.arrival_at,
      },
      role,
      required_position: requiredPositionFor(role),
      candidates,
      discarded,
    };
  };
}

module.exports = createGetCandidates;
