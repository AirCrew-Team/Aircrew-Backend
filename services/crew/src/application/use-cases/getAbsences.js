const { parseStatusFilter } = require('../../domain/entities/absence');

const NAME_FIELDS = { crew_user_id: 'crew_name', replacement_user_id: 'replacement_name' };

function createGetAbsences(absenceRepository, attachUserNames) {
  return async function getAbsences({ status } = {}) {
    const absences = await absenceRepository.findAbsences({
      status: parseStatusFilter(status),
    });
    return attachUserNames(absences, NAME_FIELDS);
  };
}

module.exports = createGetAbsences;
module.exports.NAME_FIELDS = NAME_FIELDS;
