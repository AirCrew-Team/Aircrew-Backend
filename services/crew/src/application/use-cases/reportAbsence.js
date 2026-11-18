const {
  createAbsence,
  canReportAbsenceFor,
} = require('../../domain/entities/absence');
const { DomainError } = require('../../domain/errors');

function createReportAbsence({
  flightsClient,
  absenceRepository,
  notificationClient,
}) {
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

    const created = await absenceRepository.createAbsence({
      crewUserId: user.id,
      flightId: absence.flightId,
      flightNumber: assignment.flight.flight_number,
      flightDepartureAt: assignment.flight.departure_at,
      reason: absence.reason,
      notes: absence.notes,
    });

    // Alerta en tiempo real a los supervisores, con el código del tripulante.
    // No se espera: el tripulante recibe su respuesta aunque Notification tarde o falle.
    absenceRepository
      .findAbsenceById(created.id)
      .then((detail) =>
        notificationClient.notifyAbsenceReported(detail || created, authorization)
      )
      .catch((error) =>
        console.error(`No se pudo enviar la alerta de ausencia: ${error.message}`)
      );

    return created;
  };
}

module.exports = createReportAbsence;
