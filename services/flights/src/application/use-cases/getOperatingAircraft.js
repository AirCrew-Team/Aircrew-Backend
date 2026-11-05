function createGetOperatingAircraft(aircraftRepository) {
  return function getOperatingAircraft() {
    return aircraftRepository.findOperatingAircraft();
  };
}

module.exports = createGetOperatingAircraft;
