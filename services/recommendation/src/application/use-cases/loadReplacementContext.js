const {
  isValidAbsenceId,
  assertCanBeReplaced,
} = require('../../domain/entities/replacementRequest');
const { DomainError } = require('../../domain/errors');
const { assignmentsWindow } = require('../../domain/services/flightTime');

// Asignaciones a pedir: el mes local del vuelo para cada tripulante (regla de 100 h)
// más un día a cada lado del vuelo (descanso y carga cercana).
function assignmentWindow(flight) {
  return assignmentsWindow(flight.departure_at, flight.arrival_at);
}

// Reúne lo que el motor necesita de Crew y Flights para una ausencia: la
// ausencia, su vuelo (con familia del avión y alcance), los tripulantes y las
// asignaciones del período. `authorization` es el token del supervisor o uno
// de servicio cuando corre en segundo plano.
function createLoadReplacementContext({ crewClient, flightsClient }) {
  return async function loadReplacementContext(absenceId, authorization, { allowCovered = false } = {}) {
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

    if (!allowCovered) {
      assertCanBeReplaced(absence, flight);
    }

    const assignments = await flightsClient.getAssignments(
      assignmentWindow(flight),
      authorization
    );

    const findOnFlight = (userId) =>
      assignments.find(
        (item) => item.flight.id === flight.id && item.crew_user_id === userId
      ) || null;

    // El puesto del ausente: el guardado en la ausencia, o el de su asignación.
    const absentAssignment = findOnFlight(absence.crew_user_id);
    const role = absence.slot_role || (absentAssignment && absentAssignment.role) || null;

    return { absence, flight, members, assignments, findOnFlight, absentAssignment, role };
  };
}

module.exports = createLoadReplacementContext;
