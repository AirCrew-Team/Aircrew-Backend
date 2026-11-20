const {
  isCurrentSession,
  isValidUserId,
  parseUserFilters,
  validateUserUpdate,
  validateLookupIds,
} = require('../../domain/entities/user');
const { DomainError } = require('../../domain/errors');

function notFound() {
  return new DomainError('Usuario no encontrado.', 404);
}

// Casos de uso de la administración de usuarios. Reciben el repositorio
// por parámetro, así que no dependen de PostgreSQL.
function createManageUsers(userRepository) {
  async function findExisting(id) {
    const user = isValidUserId(id) ? await userRepository.findById(id) : null;

    if (!user) {
      throw notFound();
    }

    return user;
  }

  // La cuenta del usuario del token, para restaurar la sesión al recargar.
  // Si ya no existe, está desactivada o el token es anterior al último cambio de
  // contraseña, la sesión deja de valer (401).
  async function getCurrentUser(requester) {
    const user = isValidUserId(requester.id)
      ? await userRepository.findById(requester.id)
      : null;

    if (!isCurrentSession(user, requester)) {
      throw new DomainError('La sesión ya no es válida.', 401);
    }

    // La fecha solo sirve para la comprobación: la respuesta no cambia.
    const { password_changed_at: _changedAt, ...account } = user;
    return account;
  }

  function listUsers(filters) {
    return userRepository.findUsers(parseUserFilters(filters));
  }

  async function updateUser(requester, id, input) {
    const target = await findExisting(id);
    const changes = validateUserUpdate(requester, target, input);
    return userRepository.updateUser(target.id, changes);
  }

  // No se borra: ausencias y asignaciones guardan su id. Se desactiva y
  // ya no puede iniciar sesión.
  async function deactivateUser(requester, id) {
    const target = await findExisting(id);
    const changes = validateUserUpdate(requester, target, { is_active: false });
    return userRepository.updateUser(target.id, changes);
  }

  // Para otros servicios: nombres de varios usuarios en una consulta.
  function lookupUsers(input) {
    const ids = validateLookupIds(input && input.ids);
    return userRepository.findUsersByIds(ids);
  }

  return { getCurrentUser, listUsers, updateUser, deactivateUser, lookupUsers };
}

module.exports = createManageUsers;
