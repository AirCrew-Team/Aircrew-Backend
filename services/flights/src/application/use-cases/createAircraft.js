const { createAircraft: buildAircraft } = require('../../domain/entities/aircraft');

function createCreateAircraft(aircraftRepository) {
  return async function createAircraft(input) {
    const {
      name,
      registration,
      capacity,
      minimum_crew: minimumCrew,
      initial_destination: initialDestination,
      final_destination: finalDestination,
      status,
    } = input || {};

    const aircraft = buildAircraft({
      name,
      registration,
      capacity,
      minimumCrew,
      initialDestination,
      finalDestination,
      status,
    });

    return aircraftRepository.createAircraft(aircraft);
  };
}

module.exports = createCreateAircraft;
