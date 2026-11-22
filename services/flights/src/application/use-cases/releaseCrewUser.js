const { isValidFlightId } = require('../../domain/entities/flight');
const { DomainError } = require('../../domain/errors');

// Interno (Admin, al eliminar una cuenta): borra todas las asignaciones del
// tripulante. Devuelve los vuelos que aún no salen donde su puesto quedó vacante,
// para avisar a los supervisores. Repetirlo no falla: devuelve 0.
function createReleaseCrewUser({ assignmentRepository }) {
  return async function releaseCrewUser(userId) {
    if (!isValidFlightId(userId)) {
      throw new DomainError('Se requiere un id de usuario válido.', 400);
    }

    return assignmentRepository.releaseCrewUser(userId);
  };
}

module.exports = createReleaseCrewUser;
