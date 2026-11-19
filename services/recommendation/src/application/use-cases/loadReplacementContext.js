const {
  isValidAbsenceId,
  assertCanBeReplaced,
} = require('../../domain/entities/replacementRequest');
const { DomainError } = require('../../domain/errors');

const DAY_MS = 24 * 60 * 60 * 1000;

// Asignaciones a pedir: el mes del vuelo completo (regla de 90 h) más un día a
// cada lado del vuelo (descanso y carga cercana).
function assignmentWindow(flight) {
  const departure = new Date(flight.departure_at);
  const monthStart = Date.UTC(departure.getUTCFullYear(), departure.getUTCMonth(), 1);
  const monthEnd = Date.UTC(departure.getUTCFullYear(), departure.getUTCMonth() + 1, 1);
  const from = Math.min(monthStart, departure.getTime() - DAY_MS);
  const to = Math.max(monthEnd, new Date(flight.arrival_at).getTime() + DAY_MS);

  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
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
