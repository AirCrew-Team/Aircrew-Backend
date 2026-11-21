const {
  isValidCrewUserId,
  createCrewProfile,
  validateCrewProfileUpdate,
} = require('../../domain/entities/crewMember');
const { DomainError } = require('../../domain/errors');

function notFound() {
  return new DomainError('El tripulante no tiene perfil en Crew.', 404);
}

// Perfiles de tripulante administrados por Admin: Admin crea la cuenta y le
// pide a Crew el perfil, y lo edita o desactiva cuando cambia la cuenta.
function createManageCrewProfiles(crewRepository) {
  function createProfile(input) {
    return crewRepository.createCrewMember(createCrewProfile(input));
  }

  async function updateProfile(userId, input) {
    if (!isValidCrewUserId(userId)) {
      throw notFound();
    }

    const changes = validateCrewProfileUpdate(input);
    const profile = await crewRepository.updateCrewMember(userId, changes);

    if (!profile) {
      throw notFound();
    }

    return profile;
  }

  // Solo para deshacer un alta que no terminó: nunca borra un perfil con ausencias.
  async function deleteProfile(userId) {
    const result = isValidCrewUserId(userId)
      ? await crewRepository.deleteCrewMemberWithoutHistory(userId)
      : 'not_found';

    if (result === 'not_found') {
      throw notFound();
    }

    if (result === 'has_history') {
      throw new DomainError(
        'El tripulante tiene ausencias registradas: su perfil no se puede borrar, solo desactivar.',
        409
      );
    }
  }

  function listProfiles() {
    return crewRepository.findCrewMembers();
  }

  async function getProfile(userId) {
    const profile = isValidCrewUserId(userId)
      ? await crewRepository.findCrewMemberByUserId(userId)
      : null;

    if (!profile) {
      throw notFound();
    }

    return profile;
  }

  return { createProfile, updateProfile, deleteProfile, listProfiles, getProfile };
}

module.exports = createManageCrewProfiles;
