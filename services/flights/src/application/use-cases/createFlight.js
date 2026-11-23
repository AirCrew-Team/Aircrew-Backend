const { createFlight: buildFlight } = require('../../domain/entities/flight');
const { canBeScheduled } = require('../../domain/entities/aircraft');
const { DomainError } = require('../../domain/errors');
const { DEFAULT_TIMEZONE } = require('@vuelos/shared');
const { toFlightItem } = require('./manageFlights');

// Hora local HH:mm de un instante en la zona de un aeropuerto.
function localTime(instant, timeZone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timeZone || DEFAULT_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(instant));
}

function createCreateFlight({ flightRepository, aircraftRepository, now = () => new Date() }) {
  return async function createFlight(input) {
    const {
      flight_number: flightNumber,
      aircraft_id: aircraftId,
      origin,
      destination,
      departure_at: departureAt,
      arrival_at: arrivalAt,
      status,
      gate,
    } = input || {};

    const flight = buildFlight({
      flightNumber,
      aircraftId,
      origin,
      destination,
      departureAt,
      arrivalAt,
      status,
      gate,
    });

    // Un vuelo nuevo sale en el futuro (el formulario del frontend también lo exige).
    if (new Date(flight.departureAt) <= now()) {
      throw new DomainError('La salida debe ser en el futuro.', 400, { field: 'departure_at' });
    }

    // Origen y destino deben estar en el catálogo (el JOIN con airports es LEFT).
    const known = await flightRepository.findAirportsByCodes([flight.origin, flight.destination]);
    for (const [field, code] of [['origin', flight.origin], ['destination', flight.destination]]) {
      if (!known.some((airport) => airport.code === code)) {
        throw new DomainError(`El aeropuerto ${code} no está en el catálogo.`, 400, { field });
      }
    }

    const aircraft = await aircraftRepository.findAircraftById(flight.aircraftId);

    if (!aircraft) {
      throw new DomainError('Aeronave no encontrada.', 404);
    }

    if (!canBeScheduled(aircraft)) {
      throw new DomainError('La aeronave no está operativa.', 409);
    }

    // El mismo número puede volar otro día, pero no dos veces el mismo día (UTC).
    // El índice flights_number_day_unique lo garantiza también ante dos POST a la vez.
    if (await flightRepository.findFlightByNumberOnDay(flight.flightNumber, flight.departureAt)) {
      throw new DomainError(
        `Ya existe el vuelo ${flight.flightNumber} el ${flight.departureAt.slice(0, 10)}.`,
        409,
        { field: 'flight_number' }
      );
    }

    // La aeronave no puede estar en dos vuelos a la vez. Las horas del mensaje van
    // en la zona del origen del vuelo que ya existe.
    const overlap = await flightRepository.findOverlappingFlight(
      flight.aircraftId,
      flight.departureAt,
      flight.arrivalAt
    );
    if (overlap) {
      const zone = overlap.origin_timezone;
      const from = localTime(overlap.departure_at, zone);
      const to = localTime(overlap.arrival_at, zone);
      throw new DomainError(
        `${overlap.aircraft_registration} ya vuela de ${from} a ${to} (${overlap.flight_number}).`,
        409,
        { field: 'aircraft_id' }
      );
    }

    const created = await flightRepository.createFlight(flight);
    // Mismo formato que un item de GET /flights/manage (recién creado: sin tripulación).
    return toFlightItem(await flightRepository.findFlightById(created.id));
  };
}

module.exports = createCreateFlight;
