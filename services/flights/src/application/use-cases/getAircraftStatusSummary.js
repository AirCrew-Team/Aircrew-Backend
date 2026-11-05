function createGetAircraftStatusSummary(aircraftRepository) {
  return function getAircraftStatusSummary() {
    return aircraftRepository.getAircraftStatusSummary();
  };
}

module.exports = createGetAircraftStatusSummary;
