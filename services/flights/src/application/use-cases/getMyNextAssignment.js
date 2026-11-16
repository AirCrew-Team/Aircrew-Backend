const { DomainError } = require('../../domain/errors');

function createGetMyNextAssignment(assignmentRepository) {
  return async function getMyNextAssignment(user) {
    const assignment = await assignmentRepository.findNextAssignmentByCrewUser(
      user.id,
      new Date().toISOString()
    );

    if (!assignment) {
      throw new DomainError('No tienes vuelos próximos asignados.', 404);
    }

    return assignment;
  };
}

module.exports = createGetMyNextAssignment;
