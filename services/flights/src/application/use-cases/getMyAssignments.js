function createGetMyAssignments(assignmentRepository) {
  return function getMyAssignments(user) {
    return assignmentRepository.findAssignmentsByCrewUser(user.id);
  };
}

module.exports = createGetMyAssignments;
