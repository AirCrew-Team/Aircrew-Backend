const allowedStatuses = new Set([
  'available',
  'on_duty',
  'in_flight',
  'medical_leave',
]);

function createCreateCrewMember({ createUser, saveCrewMember }) {
  return async function createCrewMember({
    name,
    email,
    employeeCode,
    position,
    currentLocation,
    status = 'available',
    isActive,
  }) {
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      typeof email !== 'string' ||
      !email.trim() ||
      typeof employeeCode !== 'string' ||
      !employeeCode.trim() ||
      typeof position !== 'string' ||
      !position.trim()
    ) {
      const error = new Error(
        'Name, email, employeeCode, and position are required.'
      );
      error.status = 400;
      throw error;
    }

    if (
      (currentLocation !== undefined &&
        currentLocation !== null &&
        (typeof currentLocation !== 'string' || !currentLocation.trim())) ||
      !allowedStatuses.has(status)
    ) {
      const error = new Error(
        'Current location must be a non-empty string and status must be one of: available, on_duty, in_flight, medical_leave.'
      );
      error.status = 400;
      throw error;
    }

    const user = await createUser({ name, email });

    if (!user || !user.id) {
      const error = new Error(
        'El servicio de admin no retorno el usuario ID.'
      );
      error.status = 502;
      throw error;
    }

    const crewMember = await saveCrewMember({
      userId: user.id,
      employeeCode,
      position,
      currentLocation: currentLocation?.trim() || null,
      status,
      isActive,
    });

    return crewMember;
  };
}

module.exports = createCreateCrewMember;