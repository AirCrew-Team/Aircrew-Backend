const { createFlight: buildFlight } = require('../../domain/entities/flight');
const { canBeScheduled } = require('../../domain/entities/aircraft');
const { DomainError } = require('../../domain/errors');

function createCreateFlight({ flightRepository, aircraftRepository }) {
  return async function createFlight(input) {
    const {
      flight_number: flightNumber,
      aircraft_id: aircraftId,
      origin,
      destination,
      departure_at: departureAt,
      arrival_at: arrivalAt,
      status,
    } = input || {};

    const flight = buildFlight({
      flightNumber,
      aircraftId,
      origin,
      destination,
      departureAt,
      arrivalAt,
      status,
    });

    const aircraft = await aircraftRepository.findAircraftById(flight.aircraftId);

    if (!aircraft) {
      throw new DomainError('Aeronave no encontrada.', 404);
    }

    if (!canBeScheduled(aircraft)) {
      throw new DomainError('La aeronave no está operativa.', 409);
    }

    return flightRepository.createFlight(flight);
  };
}

module.exports = createCreateFlight;
