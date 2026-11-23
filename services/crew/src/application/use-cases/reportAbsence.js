const { hubTimezone } = require('@vuelos/shared');
const {
  createAbsence,
  createFlightAbsence,
  canReportAbsenceFor,
  flightsWithinDates,
  REASON_LABELS,
} = require('../../domain/entities/absence');
const { DomainError } = require('../../domain/errors');

const OVERLAP_MESSAGE =
  'Ya tienes una ausencia reportada que se cruza con esas fechas.';

// El tripulante reporta una ausencia de dos formas:
// - Por vuelo (flight_id): no podrá cumplir ese vuelo. Es la solicitud de reemplazo.
// - Por fechas (start_date, end_date y comprobante si es incapacidad): no podrá volar
//   esos días. Por cada vuelo suyo en esas fechas se crea además una ausencia por vuelo
//   (parent_absence_id = la de fechas), y cada una es una solicitud de reemplazo.
// Cada solicitud de reemplazo queda con suggestions_state = searching y, en segundo
// plano, se pide a Recommendation que busque candidatos con Claude.
function createReportAbsence({
  absenceRepository,
  notificationClient,
  flightsClient,
  recommendationClient,
  findCrewMemberByUserId = async () => null,
  now = () => new Date(),
}) {
  // Primer evento de la línea de tiempo y búsqueda de reemplazos (sin esperar).
  function startReplacementSearch(absence) {
    runInBackground(async () => {
      const detail = await absenceRepository.findAbsenceById(absence.id);
      const who = (detail && detail.employee_code) || 'El tripulante';
      await absenceRepository.addAbsenceEvent(
        absence.id,
        'reported',
        `${who} reportó ${REASON_LABELS[absence.reason]}`
      );
      if (recommendationClient) await recommendationClient.requestSuggestions(absence.id);
    });
  }

  async function reportFlightAbsence(user, authorization, input) {
    const { flight_id: flightId, reason, notes } = input;
    const absence = createFlightAbsence({ flightId, reason, notes });

    const assignments = await flightsClient.getMyAssignments(authorization);
    const assignment = assignments.find((item) => item.flight.id === absence.flightId);

    if (!assignment) {
      throw new DomainError('No tienes asignado ese vuelo.', 404, { code: 'flight_not_assigned' });
    }

    if (!canReportAbsenceFor(assignment.flight, now())) {
      throw new DomainError(
        'Solo puedes reportar ausencia en un vuelo que todavía no ha salido.',
        409,
        { code: 'flight_departed' }
      );
    }

    const created = await absenceRepository.createAbsence({
      ...flightAbsenceFrom(user.id, assignment, absence),
    });

    runInBackground(async () => {
      const detail = (await absenceRepository.findAbsenceById(created.id)) || created;
      await notificationClient.notifyAbsenceReported(detail, authorization);
    });
    startReplacementSearch(created);

    return created;
  }

  async function reportDatesAbsence(user, authorization, input) {
    const { start_date: startDate, end_date: endDate, reason, notes, attachment } = input;
    // Todo se valida antes de abrir la transacción.
    const absence = createAbsence({ startDate, endDate, reason, notes, attachment }, now());

    // Vuelos del tripulante en esas fechas, en los días de la zona de su base. Si
    // Flights no responde, la ausencia se guarda igual (el comprobante no se pierde)
    // y queda sin solicitudes de reemplazo.
    let affected = [];
    if (flightsClient) {
      try {
        const [assignments, member] = await Promise.all([
          flightsClient.getMyAssignments(authorization),
          findCrewMemberByUserId(user.id),
        ]);
        const zone = hubTimezone(member && member.base);
        affected = flightsWithinDates(assignments, absence.startDate, absence.endDate, now(), zone);
      } catch (error) {
        console.error(`[crew] Ausencia por fechas sin solicitudes de reemplazo: ${error.message}`);
      }
    }

    // Con el tripulante bloqueado, dos envíos simultáneos van en fila y el
    // segundo ve la ausencia del primero. Ausencia, adjunto y solicitudes van juntos.
    const created = await absenceRepository.withCrewMemberLock(user.id, async (tx) => {
      const overlapping = await tx.hasOverlappingAbsence({
        crewUserId: user.id,
        startDate: absence.startDate,
        endDate: absence.endDate,
      });

      if (overlapping) {
        throw new DomainError(OVERLAP_MESSAGE, 409);
      }

      const row = await tx.insertAbsence({
        crewUserId: user.id,
        startDate: absence.startDate,
        endDate: absence.endDate,
        reason: absence.reason,
        notes: absence.notes,
      });
      const saved = absence.attachment
        ? await tx.insertAttachment({ absenceId: row.id, ...absence.attachment })
        : null;

      const requests = [];
      for (const assignment of affected) {
        const request = await tx.insertFlightAbsence({
          ...flightAbsenceFrom(user.id, assignment, absence),
          parentAbsenceId: row.id,
        });
        if (request) requests.push(request);
      }

      return { ...row, attachment: saved, replacement_requests: requests };
    });

    // Alerta en tiempo real a los supervisores, con el código del tripulante.
    // No se espera: el tripulante recibe su respuesta aunque Notification tarde o falle.
    absenceRepository
      .findAbsenceById(created.id)
      .then((detail) => notificationClient.notifyAbsenceReported(detail || created, authorization))
      .catch((error) => console.error(`No se pudo enviar la alerta de ausencia: ${error.message}`));

    for (const request of created.replacement_requests) startReplacementSearch(request);

    return created;
  }

  return async function reportAbsence(user, authorization, input) {
    const body = input || {};
    return body.flight_id !== undefined
      ? reportFlightAbsence(user, authorization, body)
      : reportDatesAbsence(user, authorization, body);
  };
}

// Datos de una ausencia por vuelo a partir de la asignación (copia del vuelo para la cola).
function flightAbsenceFrom(crewUserId, assignment, absence) {
  return {
    crewUserId,
    flightId: assignment.flight.id,
    flightNumber: assignment.flight.flight_number,
    flightDepartureAt: assignment.flight.departure_at,
    flightOrigin: assignment.flight.origin,
    flightDestination: assignment.flight.destination,
    slotRole: assignment.role,
    reason: absence.reason,
    notes: absence.notes,
  };
}

function runInBackground(task) {
  task().catch((error) =>
    console.error(`Falló una tarea en segundo plano de la ausencia: ${error.message}`)
  );
}

module.exports = createReportAbsence;
