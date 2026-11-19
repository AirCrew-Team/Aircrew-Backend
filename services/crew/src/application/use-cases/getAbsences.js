const { parseStatusFilter } = require('../../domain/entities/absence');

const NAME_FIELDS = { crew_user_id: 'crew_name', replacement_user_id: 'replacement_name' };

// Datos del vuelo que pinta cada tarjeta de la cola (puerta, aeropuertos y avión).
const EMPTY_FLIGHT = { gate: null, origin_name: null, destination_name: null, aircraft_family: null };

function flightFields(flight) {
  if (!flight) return EMPTY_FLIGHT;
  return {
    gate: flight.gate || null,
    origin_name: flight.origin_name || null,
    destination_name: flight.destination_name || null,
    aircraft_family: flight.aircraft_family || null,
  };
}

// Pide a Flights todos los vuelos de la lista en una sola llamada. Si Flights no
// responde, la cola se muestra igual con esos campos en null.
async function attachFlightDetails(absences, flightsClient, authorization) {
  const ids = [...new Set(absences.map((absence) => absence.flight_id).filter(Boolean))];
  let byId = new Map();

  if (ids.length > 0 && flightsClient) {
    try {
      const flights = await flightsClient.getFlightsByIds(ids, authorization);
      byId = new Map(flights.map((flight) => [flight.id, flight]));
    } catch (error) {
      console.error(`[crew] La cola de ausencias sale sin datos del vuelo: ${error.message}`);
    }
  }

  return absences.map((absence) => ({ ...absence, ...flightFields(byId.get(absence.flight_id)) }));
}

function createGetAbsences(absenceRepository, attachUserNames, flightsClient) {
  return async function getAbsences({ status } = {}, authorization) {
    const absences = await absenceRepository.findAbsences({
      status: parseStatusFilter(status),
    });
    const named = await attachUserNames(absences, NAME_FIELDS);
    return attachFlightDetails(named, flightsClient, authorization);
  };
}

module.exports = createGetAbsences;
module.exports.NAME_FIELDS = NAME_FIELDS;
