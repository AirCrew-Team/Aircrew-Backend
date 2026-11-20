const { canViewUser } = require('../../domain/entities/user');
const { DomainError } = require('../../domain/errors');

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createGetUserById(userRepository) {
  return async function getUserById(requester, id) {
    if (!canViewUser(requester, id)) {
      throw new DomainError('No tienes permisos para esta acción.', 403);
    }

    const user = uuidPattern.test(id) ? await userRepository.findById(id) : null;

    if (!user) {
      throw new DomainError('Usuario no encontrado.', 404);
    }

    // findById trae password_changed_at para /auth/me; esta respuesta no lo incluye.
    const { password_changed_at: _changedAt, ...account } = user;
    return account;
  };
}

module.exports = createGetUserById;
