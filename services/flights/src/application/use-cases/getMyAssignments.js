function parseBoolean(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

// Vuelos del tripulante. ?replacement=true&acknowledged=false devuelve los
// reemplazos que todavía no confirmó con «Enterado».
function createGetMyAssignments(assignmentRepository) {
  return function getMyAssignments(user, { replacement, acknowledged } = {}) {
    return assignmentRepository.findAssignmentsByCrewUser(user.id, {
      replacement: parseBoolean(replacement),
      acknowledged: parseBoolean(acknowledged),
    });
  };
}

module.exports = createGetMyAssignments;
