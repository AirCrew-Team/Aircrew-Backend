const {
  isValidAbsenceId,
  validateCoverage,
} = require('../../domain/entities/absence');
const { DomainError } = require('../../domain/errors');

// Marca la ausencia como cubierta y guarda quién la reemplazó.
function createCoverAbsence(absenceRepository) {
  return async function coverAbsence(id, input) {
    const { replacement_user_id: replacementUserId } = input || {};

    const absence = isValidAbsenceId(id)
      ? await absenceRepository.findAbsenceById(id)
      : null;

    if (!absence) {
      throw new DomainError('Ausencia no encontrada.', 404);
    }

    validateCoverage(absence, replacementUserId);

    const covered = await absenceRepository.markAbsenceCovered(
      absence.id,
      replacementUserId
    );

    if (!covered) {
      throw new DomainError('La ausencia ya está cubierta.', 409);
    }

    return covered;
  };
}

module.exports = createCoverAbsence;
