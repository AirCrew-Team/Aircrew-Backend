const { DomainError } = require('../../domain/errors');

// El perfil del tripulante que inició sesión: base, cargo y estado.
function createGetMyCrewProfile(findCrewMemberByUserId, attachUserNames) {
  return async function getMyCrewProfile(user) {
    const profile = await findCrewMemberByUserId(user.id);

    if (!profile) {
      throw new DomainError('No tienes un perfil de tripulante.', 404);
    }

    const [named] = await attachUserNames([profile], { user_id: 'name' });
    return named;
  };
}

module.exports = createGetMyCrewProfile;
