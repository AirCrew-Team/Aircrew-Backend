const {
  canAssignCrewTo,
  createReplacement,
  findConflictingFlight,
} = require('../../domain/entities/assignment');
const { isValidFlightId } = require('../../domain/entities/flight');
const { parseInstant } = require('../../domain/value-objects/instant');

const SOURCES = ['manual', 'ai', 'rule'];

function createReplacementMetadata(info, user) {
  if (!info) return null;

  const deadline = info.deadline_at ? parseInstant(info.deadline_at) : null;
  if (info.deadline_at && !deadline) {
    throw new DomainError('replacement.deadline_at debe ser ISO-8601 con zona horaria.', 400, {
      field: 'replacement.deadline_at',
    });
  }

  return {
    reason: typeof info.reason === 'string' ? info.reason : null,
    approvedBy: user && user.role !== 'service' ? user.id : null,
    approvedByName: typeof info.approved_by_name === 'string' ? info.approved_by_name : null,
    deadlineAt: deadline ? deadline.toISOString() : null,
    source: SOURCES.includes(info.source) ? info.source : 'manual',
    rationale: typeof info.rationale === 'string' ? info.rationale : null,
  };
}
const { DomainError } = require('../../domain/errors');

// Cambia a un tripulante por otro en un vuelo. El reemplazo hereda el rol y el
// puesto. Si viene de una ausencia (replacement), queda marcado como reemplazo
// con quién lo aprobó y el plazo para dar «Enterado».
function createReplaceCrewMember({ flightRepository, assignmentRepository }) {
  return async function replaceCrewMember(flightId, input, user) {
    const {
      replaced_crew_user_id: replacedCrewUserId,
      crew_user_id: crewUserId,
      replacement: replacementInfo,
    } = input || {};
    const replacement = createReplacement({ replacedCrewUserId, crewUserId });
    const metadata = createReplacementMetadata(replacementInfo, user);

    const flight = isValidFlightId(flightId)
      ? await flightRepository.findFlightById(flightId)
      : null;

    if (!flight) {
      throw new DomainError('Vuelo no encontrado.', 404);
    }

    if (!canAssignCrewTo(flight)) {
      throw new DomainError(
        'Solo se puede reemplazar tripulación en vuelos programados o demorados.',
        409
      );
    }

    const current = await assignmentRepository.findActiveAssignment(
      flight.id,
      replacement.replacedCrewUserId
    );

    if (!current) {
      throw new DomainError(
        'El tripulante a reemplazar no tiene una asignación activa en este vuelo.',
        404
      );
    }

    const otherFlights = await assignmentRepository.findActiveFlightsByCrewUser(
      replacement.crewUserId
    );
    const conflict = findConflictingFlight(otherFlights, flight);

    if (conflict) {
      throw new DomainError(
        `El reemplazo ya tiene el vuelo ${conflict.flight_number} en ese horario.`,
        409
      );
    }

    return assignmentRepository.replaceAssignment({
      assignmentId: current.id,
      flightId: flight.id,
      crewUserId: replacement.crewUserId,
      role: current.role,
      replacement: metadata,
    });
  };
}

module.exports = createReplaceCrewMember;
