const {
  isValidAbsenceId,
  assertCanBeReplaced,
} = require('../../domain/entities/replacementRequest');
const { LOAD_WINDOW_HOURS } = require('../../domain/services/scoring');
const { DomainError } = require('../../domain/errors');

const HOUR_MS = 60 * 60 * 1000;

// Reúne lo que el motor necesita de Crew y Flights para una ausencia:
// la ausencia, su vuelo, los tripulantes y las asignaciones cercanas.
function createLoadReplacementContext({ crewClient, flightsClient }) {
  return async function loadReplacementContext(absenceId, authorization) {
    if (!isValidAbsenceId(absenceId)) {
      throw new DomainError('Ausencia no encontrada.', 404);
    }

    const absence = await crewClient.getAbsence(absenceId, authorization);

    // Las ausencias por fechas no tienen un vuelo en el que reemplazar.
    if (!absence.flight_id) {
      throw new DomainError('Esta ausencia no tiene un vuelo asociado.', 409);
    }

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

    const findOnFlight = (userId) =>
      assignments.find(
        (item) => item.flight.id === flight.id && item.crew_user_id === userId
      ) || null;

    return { absence, flight, members, assignments, findOnFlight };
  };
}

module.exports = createLoadReplacementContext;
