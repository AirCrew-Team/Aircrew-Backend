const { DomainError } = require('../../domain/errors');

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// El reemplazo pulsa «Enterado»: confirma que cubrirá el vuelo. Flights lo
// registra y avisa a Crew para que la ausencia quede cubierta.
function createAcknowledgeReplacement({ assignmentRepository, crewClient }) {
  return async function acknowledgeReplacement(user, assignmentId) {
    const acknowledged = uuidPattern.test(String(assignmentId))
      ? await assignmentRepository.acknowledgeAssignment(assignmentId, user.id)
      : null;

    if (!acknowledged) {
      const existing = uuidPattern.test(String(assignmentId))
        ? await assignmentRepository.findAssignmentById(assignmentId)
        : null;

      if (!existing || existing.crew_user_id !== user.id) {
        throw new DomainError('Asignación no encontrada.', 404);
      }
      if (!existing.is_replacement) {
        throw new DomainError('Esta asignación no es un reemplazo.', 409, { code: 'not_a_replacement' });
      }
      if (existing.acknowledged_at) {
        throw new DomainError('Ya confirmaste este reemplazo.', 409, { code: 'already_acknowledged' });
      }
      throw new DomainError('Este reemplazo ya no está activo.', 409, { code: 'replacement_inactive' });
    }

    await crewClient.markAbsenceAcknowledged({
      flightId: acknowledged.flight_id,
      replacementUserId: user.id,
    });

    return acknowledged;
  };
}

module.exports = createAcknowledgeReplacement;
