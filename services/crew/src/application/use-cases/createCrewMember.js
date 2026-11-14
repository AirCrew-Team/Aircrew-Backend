const { createCrewMember: buildCrewMember } = require('../../domain/entities/crewMember');

function createCreateCrewMember({ createUser, saveCrewMember }) {
  return async function createCrewMember(input) {
    const crewMember = buildCrewMember(input || {});

    const user = await createUser({
      name: crewMember.name,
      email: crewMember.email,
    });

    if (!user || !user.id) {
      const error = new Error(
        'El servicio de Admin no devolvió el id del usuario.'
      );
      error.status = 502;
      throw error;
    }

    return saveCrewMember({
      userId: user.id,
      employeeCode: crewMember.employeeCode,
      position: crewMember.position,
      currentLocation: crewMember.currentLocation,
      status: crewMember.status,
      isActive: crewMember.isActive,
    });
  };
}

module.exports = createCreateCrewMember;
