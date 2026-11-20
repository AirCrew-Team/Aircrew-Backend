const { isValidAbsenceId } = require('../../domain/entities/absence');
const { DomainError } = require('../../domain/errors');

// Comprobante de una ausencia con sus bytes, para descargarlo.
function createGetAbsenceAttachment(absenceRepository) {
  return async function getAbsenceAttachment(id) {
    const attachment = isValidAbsenceId(id)
      ? await absenceRepository.findAttachment(id)
      : null;

    if (!attachment) {
      throw new DomainError('La ausencia no existe o no tiene comprobante.', 404);
    }

    return attachment;
  };
}

module.exports = createGetAbsenceAttachment;
