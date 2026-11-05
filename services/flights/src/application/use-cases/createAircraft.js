const allowedStatuses = new Set(['operating', 'maintenance', 'inactive']);

function createCreateAircraft(aircraftRepository) {
  return async function createAircraft(input) {
    const {
      name,
      registration,
      capacity,
      minimum_crew: minimumCrew,
      initial_destination: initialDestination,
      final_destination: finalDestination,
      status = 'operating',
    } = input || {};

    if (
      typeof name !== 'string' ||
      !name.trim() ||
      typeof registration !== 'string' ||
      !registration.trim() ||
      !Number.isInteger(capacity) ||
      capacity <= 0 ||
      !Number.isInteger(minimumCrew) ||
      minimumCrew < 0 ||
      typeof initialDestination !== 'string' ||
      !initialDestination.trim() ||
      typeof finalDestination !== 'string' ||
      !finalDestination.trim() ||
      typeof status !== 'string' ||
      !allowedStatuses.has(status)
    ) {
      const error = new Error(
        'Name, registration, positive capacity, non-negative minimum_crew, initial_destination, final_destination, and a valid status are required.'
      );
      error.status = 400;
      throw error;
    }

    return aircraftRepository.createAircraft({
      name: name.trim(),
      registration: registration.trim().toUpperCase(),
      capacity,
      minimumCrew,
      initialDestination: initialDestination.trim(),
      finalDestination: finalDestination.trim(),
      status,
    });
  };
}

module.exports = createCreateAircraft;
