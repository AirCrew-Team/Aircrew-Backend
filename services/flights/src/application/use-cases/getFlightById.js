const { isValidFlightId } = require('../../domain/entities/flight');
const { DomainError } = require('../../domain/errors');

function createGetFlightById(flightRepository) {
  return async function getFlightById(id) {
    const flight = isValidFlightId(id)
      ? await flightRepository.findFlightById(id)
      : null;

    if (!flight) {
      throw new DomainError('Vuelo no encontrado.', 404);
    }

    return flight;
  };
}

module.exports = createGetFlightById;
