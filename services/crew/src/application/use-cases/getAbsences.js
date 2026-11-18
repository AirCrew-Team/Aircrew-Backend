const { parseStatusFilter } = require('../../domain/entities/absence');

function createGetAbsences(absenceRepository) {
  return function getAbsences({ status } = {}) {
    return absenceRepository.findAbsences({
      status: parseStatusFilter(status),
    });
  };
}

module.exports = createGetAbsences;
