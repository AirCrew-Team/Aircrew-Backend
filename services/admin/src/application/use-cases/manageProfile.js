const { isCurrentSession, isValidUserId } = require('../../domain/entities/user');
const { DomainError } = require('../../domain/errors');
const {
  toProfile,
  validateProfileUpdate,
  parsePhoto,
} = require('../../domain/profile');

function invalidSession() {
  return new DomainError('La sesión ya no es válida.', 401);
}

// Perfil y foto de la propia cuenta (Configuración). Solo actúan sobre el
// usuario del token. Una cuenta inexistente o desactivada, o un token anterior al
// último cambio de contraseña, responde 401, como /auth/me.
function createManageProfile(userRepository) {
  function sessionUserId(requester) {
    if (!isValidUserId(requester.id)) {
      throw invalidSession();
    }
    return requester.id;
  }

  async function activeProfile(requester) {
    const row = await userRepository.findProfileById(sessionUserId(requester));

    if (!isCurrentSession(row, requester)) {
      throw invalidSession();
    }

    return row;
  }

  async function getMyProfile(requester) {
    return toProfile(await activeProfile(requester));
  }

  // Valida todo antes de tocar la base. Después comprueba la sesión: un token
  // anterior al último cambio de contraseña no puede escribir.
  async function updateMyProfile(requester, input) {
    const changes = validateProfileUpdate(requester.role, input);
    const { id } = await activeProfile(requester);
    const row = await userRepository.updateProfile(id, changes);

    if (!row) {
      throw invalidSession();
    }

    return toProfile(row);
  }

  async function savePhoto(requester, input) {
    const photo = parsePhoto(input);
    const { id } = await activeProfile(requester);
    const updatedAt = await userRepository.savePhoto(id, photo);

    if (!updatedAt) {
      throw invalidSession();
    }

    return { photo_updated_at: updatedAt };
  }

  async function getPhoto(requester) {
    const { id } = await activeProfile(requester);
    const photo = await userRepository.findPhoto(id);

    if (!photo) {
      throw new DomainError('No tienes foto de perfil.', 404);
    }

    return photo;
  }

  // Sin foto también responde bien: el resultado es el mismo.
  async function deletePhoto(requester) {
    const { id } = await activeProfile(requester);
    await userRepository.deletePhoto(id);
  }

  return { getMyProfile, updateMyProfile, savePhoto, getPhoto, deletePhoto };
}

module.exports = createManageProfile;
