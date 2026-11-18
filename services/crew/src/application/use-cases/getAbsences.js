function createGetAbsences(absenceRepository) {
  return function getAbsences() {
    return absenceRepository.findAbsences();
  };
}

module.exports = createGetAbsences;
