const { canViewUser, isValidUserId } = require('../../domain/entities/user');
const { DomainError } = require('../../domain/errors');
const { toUserItem } = require('./manageUsers');

// Ficha de un usuario: los mismos campos que la fila de la lista. Si es
// tripulante, su perfil viene de Crew (null si Crew no responde).
function createGetUserById(userRepository, { crewClient } = {}) {
  return async function getUserById(requester, id) {
    if (!canViewUser(requester, id)) {
      throw new DomainError('No tienes permisos para esta acción.', 403);
    }

    const user = isValidUserId(id) ? await userRepository.findUserDetailById(id) : null;

    if (!user) {
      throw new DomainError('Usuario no encontrado.', 404);
    }

    let crewProfile = null;

    if (user.role === 'crew' && crewClient) {
      try {
        crewProfile = await crewClient.getProfile(user.id);
      } catch (error) {
        console.error(`No se pudo cargar el perfil de Crew de ${user.id}: ${error.message}`);
      }
    }

    return toUserItem(user, crewProfile);
  };
}

module.exports = createGetUserById;
