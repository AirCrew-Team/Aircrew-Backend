const { isValidAbsenceId } = require('../../domain/entities/absence');
const { DomainError } = require('../../domain/errors');
const { NAME_FIELDS } = require('./getAbsences');

function createGetAbsenceById(absenceRepository, attachUserNames) {
  return async function getAbsenceById(id) {
    const absence = isValidAbsenceId(id)
      ? await absenceRepository.findAbsenceById(id)
      : null;

    if (!absence) {
      throw new DomainError('Ausencia no encontrada.', 404);
    }

    const [named] = await attachUserNames([absence], NAME_FIELDS);
    return named;
  };
}

module.exports = createGetAbsenceById;
