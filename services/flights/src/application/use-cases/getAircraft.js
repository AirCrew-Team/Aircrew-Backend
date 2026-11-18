const { AIRCRAFT_STATUSES } = require('../../domain/entities/aircraft');
const { DomainError } = require('../../domain/errors');

// Lista de aeronaves para la pantalla de flota; filtro opcional por estado.
function createGetAircraft(aircraftRepository) {
  return function getAircraft({ status } = {}) {
    if (status !== undefined && status !== '' && !AIRCRAFT_STATUSES.includes(status)) {
      throw new DomainError(`status debe ser uno de: ${AIRCRAFT_STATUSES.join(', ')}.`);
    }

    return aircraftRepository.findAircraft({ status: status || null });
  };
}

module.exports = createGetAircraft;
