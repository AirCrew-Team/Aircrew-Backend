const { evaluateReplacements } = require('../../domain/services/replacementRanking');
const { acknowledgementDeadline } = require('../../domain/services/acknowledgementDeadline');
const { isValidUserId } = require('../../domain/entities/replacementRequest');
const { DomainError } = require('../../domain/errors');
const { absentNotAssignedError, toFlightSummary } = require('./getCandidates');

// El supervisor confirma un candidato:
// 1. Vuelve a evaluar las 8 reglas con datos frescos (pudieron cambiar).
// 2. Flights pone al candidato en el puesto, marcado como reemplazo, con
//    quién lo aprobó y un plazo para dar «Enterado».
// 3. Crew deja la ausencia en pending_ack (esperando confirmación).
// 4. El candidato recibe el aviso en su canal (assignment:replacement).
// La ausencia queda cubierta cuando el reemplazo pulsa «Enterado»; si vence
// el plazo, la revisión de plazos la devuelve a la cola.
// Si el paso 3 falla, reintentar es seguro: el paso 2 ya hecho se detecta.
function createConfirmReplacement({
  loadReplacementContext,
  crewClient,
  flightsClient,
  adminClient,
  suggestionRepository,
  notificationClient,
}) {
  return async function confirmReplacement(absenceId, authorization, input, user) {
    const { candidate_user_id: candidateUserId } = input || {};

    if (!isValidUserId(candidateUserId)) {
      throw new DomainError('Se requiere un candidate_user_id válido.', 400, {
        field: 'candidate_user_id',
      });
    }

    const { absence, flight, members, assignments, findOnFlight, absentAssignment, role } =
      await loadReplacementContext(absenceId, authorization);

    const suggestions = await suggestionRepository.findLatestRound(absence.id);
    const suggestion = suggestions.find((item) => item.crew_user_id === candidateUserId);

    if (suggestion && suggestion.status === 'missed') {
      throw new DomainError('Ese tripulante ya dejó vencer su plazo para esta ausencia.', 409, {
        code: 'candidate_missed',
      });
    }

    const deadlineAt = acknowledgementDeadline(flight.departure_at);
    let assignment = null;

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

      const approver = await adminClient.getUser(user.id, authorization).catch(() => null);
      const result = await flightsClient.replaceCrewMember(
        flight.id,
        {
          replaced_crew_user_id: absence.crew_user_id,
          crew_user_id: candidateUserId,
          replacement: {
            reason: absence.reason,
            approved_by_name: approver ? approver.name : null,
            deadline_at: deadlineAt,
            source: suggestion ? suggestion.source : 'manual',
            rationale: suggestion ? suggestion.rationale : null,
          },
        },
        authorization
      );
      assignment = result.assignment;
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
      assignment = candidateAssignment;
    }

    let approved;
    try {
      approved = await crewClient.approveReplacement(
        absence.id,
        {
          replacementUserId: candidateUserId,
          deadlineAt,
          option: suggestion ? suggestion.rank_position : null,
        },
        authorization
      );
    } catch (cause) {
      const error = new Error(
        'El reemplazo quedó hecho en el vuelo, pero no se pudo actualizar la ausencia. Intenta confirmar de nuevo.',
        { cause }
      );
      error.status = 502;
      throw error;
    }

    if (suggestion) {
      await suggestionRepository.markStatus(absence.id, candidateUserId, 'offered');
    }

    // Aviso al elegido en su canal personal. No se espera.
    notificationClient.notifyAssignmentReplacement(
      {
        crew_user_id: candidateUserId,
        assignment_id: assignment && assignment.id,
        flight_number: flight.flight_number,
        deadline_at: deadlineAt,
      },
      authorization
    );

    return {
      absence: approved,
      flight: toFlightSummary(flight),
      replacement: assignment,
      deadline_at: deadlineAt,
    };
  };
}

module.exports = createConfirmReplacement;
