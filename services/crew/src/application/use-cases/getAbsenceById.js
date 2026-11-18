const { isValidAbsenceId } = require('../../domain/entities/absence');
const { DomainError } = require('../../domain/errors');

function createGetAbsenceById(absenceRepository) {
  return async function getAbsenceById(id) {
    const absence = isValidAbsenceId(id)
      ? await absenceRepository.findAbsenceById(id)
      : null;

    if (!absence) {
      throw new DomainError('Ausencia no encontrada.', 404);
    }

    return absence;
  };
}

module.exports = createGetAbsenceById;
