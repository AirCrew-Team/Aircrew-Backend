const {
  createAbsence,
  canReportAbsenceFor,
} = require('../../domain/entities/absence');
const { DomainError } = require('../../domain/errors');

function createReportAbsence({ flightsClient, absenceRepository }) {
  return async function reportAbsence(user, authorization, input) {
    const { flight_id: flightId, reason, notes } = input || {};
    const absence = createAbsence({ flightId, reason, notes });

    const assignments = await flightsClient.getMyAssignments(authorization);
    const assignment = assignments.find(
      (item) => item.flight.id === absence.flightId
    );

    if (!assignment) {
      throw new DomainError('No tienes asignado ese vuelo.', 404);
    }

    if (!canReportAbsenceFor(assignment.flight)) {
      throw new DomainError(
        'Solo puedes reportar ausencia en un vuelo que todavía no ha salido.',
        409
      );
    }

    // Paso 3: aquí Crew pedirá a Recommendation que busque reemplazo.
    return absenceRepository.createAbsence({
      crewUserId: user.id,
      flightId: absence.flightId,
      flightNumber: assignment.flight.flight_number,
      flightDepartureAt: assignment.flight.departure_at,
      reason: absence.reason,
      notes: absence.notes,
    });
  };
}

module.exports = createReportAbsence;
