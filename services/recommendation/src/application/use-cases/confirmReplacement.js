const { evaluateReplacements } = require('../../domain/services/replacementRanking');
const { isValidUserId } = require('../../domain/entities/replacementRequest');
const { DomainError } = require('../../domain/errors');
const { absentNotAssignedError, toFlightSummary } = require('./getCandidates');

// Confirma el reemplazo elegido por el supervisor:
// 1. Vuelve a evaluar las reglas con datos frescos (pudieron cambiar).
// 2. Flights cambia al ausente por el candidato en el vuelo.
// 3. Crew marca la ausencia como cubierta.
// Si el paso 3 falla, reintentar es seguro: el paso 2 ya hecho se detecta y se salta.
function createConfirmReplacement({
  loadReplacementContext,
  crewClient,
  flightsClient,
  notificationClient,
}) {
  return async function confirmReplacement(absenceId, authorization, input) {
    const { candidate_user_id: candidateUserId } = input || {};

    if (!isValidUserId(candidateUserId)) {
      throw new DomainError('Se requiere un candidate_user_id válido.');
    }

    const { absence, flight, members, assignments, findOnFlight, absentAssignment, role } =
      await loadReplacementContext(absenceId, authorization);

    let replacement = null;

    if (absentAssignment) {
      const { eligible, ineligible } = evaluateReplacements({
        members,
        flight,
        role,
        absentUserId: absence.crew_user_id,
        assignments,
      });

      if (!eligible.some((item) => item.member.user_id === candidateUserId)) {
        const rejected = ineligible.find((item) => item.member.user_id === candidateUserId);
        throw new DomainError(
          rejected
            ? `El tripulante no puede cubrir esta ausencia: ${rejected.reason}`
            : 'El tripulante no es un candidato para esta ausencia.',
          409,
          { code: 'candidate_not_eligible' }
        );
      }

      replacement = await flightsClient.replaceCrewMember(
        flight.id,
        {
          replaced_crew_user_id: absence.crew_user_id,
          crew_user_id: candidateUserId,
        },
        authorization
      );
    } else {
      // Reintento: el ausente ya salió del vuelo. Solo seguimos si fue por este
      // candidato, es decir, si lo asignaron después de reportada la ausencia.
      const candidateAssignment = findOnFlight(candidateUserId);

      if (
        !candidateAssignment ||
        new Date(candidateAssignment.created_at) < new Date(absence.created_at)
      ) {
        throw absentNotAssignedError();
      }
    }

    let covered;

    try {
      covered = await crewClient.coverAbsence(
        absence.id,
        candidateUserId,
        authorization
      );
    } catch (cause) {
      const error = new Error(
        'El reemplazo quedó hecho en el vuelo, pero no se pudo marcar la ausencia como cubierta. Intenta confirmar de nuevo.',
        { cause }
      );
      error.status = 502;
      throw error;
    }

    // Actualiza la cola de los demás supervisores conectados. No se espera.
    notificationClient.notifyAbsenceCovered(
      { ...covered, employee_code: absence.employee_code },
      authorization
    );

    return {
      absence: covered,
      flight: toFlightSummary(flight),
      replacement: replacement && replacement.assignment,
    };
  };
}

module.exports = createConfirmReplacement;
