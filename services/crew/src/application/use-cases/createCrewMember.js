const { createCrewMember: buildCrewMember } = require('../../domain/entities/crewMember');

function createCreateCrewMember({ createUser, saveCrewMember }) {
  return async function createCrewMember(input) {
    const { name, email, ...profile } = buildCrewMember(input || {});

    const user = await createUser({ name, email });

    if (!user || !user.id) {
      const error = new Error(
        'El servicio de Admin no devolvió el id del usuario.'
      );
      error.status = 502;
      throw error;
    }

    return saveCrewMember({ userId: user.id, ...profile });
  };
}

module.exports = createCreateCrewMember;
