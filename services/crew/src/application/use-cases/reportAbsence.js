const {
  createAbsence,
  canReportAbsenceFor,
  REASON_LABELS,
} = require('../../domain/entities/absence');
const { DomainError } = require('../../domain/errors');

// El tripulante reporta que no podrá cumplir un vuelo asignado.
// 1. Crew comprueba con Flights que el vuelo sea suyo y no haya salido.
// 2. Guarda la ausencia (suggestions_state: searching) y su primer evento.
// 3. En segundo plano: alerta a los supervisores y pide a Recommendation que
//    busque reemplazos. El tripulante recibe su respuesta sin esperar eso.
function createReportAbsence({
  flightsClient,
  absenceRepository,
  notificationClient,
  recommendationClient,
}) {
  return async function reportAbsence(user, authorization, input) {
    const { flight_id: flightId, reason, notes } = input || {};
    const absence = createAbsence({ flightId, reason, notes });

    const assignments = await flightsClient.getMyAssignments(authorization);
    const assignment = assignments.find(
      (item) => item.flight.id === absence.flightId
    );

    if (!assignment) {
      throw new DomainError('No tienes asignado ese vuelo.', 404, {
        code: 'flight_not_assigned',
      });
    }

    if (!canReportAbsenceFor(assignment.flight)) {
      throw new DomainError(
        'Solo puedes reportar ausencia en un vuelo que todavía no ha salido.',
        409,
        { code: 'flight_departed' }
      );
    }

    const created = await absenceRepository.createAbsence({
      crewUserId: user.id,
      flightId: absence.flightId,
      flightNumber: assignment.flight.flight_number,
      flightDepartureAt: assignment.flight.departure_at,
      flightOrigin: assignment.flight.origin,
      flightDestination: assignment.flight.destination,
      slotRole: assignment.role,
      reason: absence.reason,
      notes: absence.notes,
    });

    runInBackground(async () => {
      const detail = (await absenceRepository.findAbsenceById(created.id)) || created;
      await absenceRepository.addAbsenceEvent(
        created.id,
        'reported',
        `${detail.employee_code || 'El tripulante'} reportó ${REASON_LABELS[created.reason]}`
      );
      await Promise.all([
        notificationClient.notifyAbsenceReported(detail, authorization),
        recommendationClient.requestSuggestions(created.id),
      ]);
    });

    return created;
  };
}

function runInBackground(task) {
  task().catch((error) =>
    console.error(`Falló una tarea en segundo plano de la ausencia: ${error.message}`)
  );
}

module.exports = createReportAbsence;
