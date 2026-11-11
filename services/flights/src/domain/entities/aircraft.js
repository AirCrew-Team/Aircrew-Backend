const { DomainError } = require('../errors');

const AIRCRAFT_STATUSES = ['operating', 'maintenance', 'inactive'];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

// Valida y normaliza los datos de una aeronave nueva.
function createAircraft({
  name,
  registration,
  capacity,
  minimumCrew,
  initialDestination,
  finalDestination,
  status = 'operating',
}) {
  if (
    !isNonEmptyString(name) ||
    !isNonEmptyString(registration) ||
    !Number.isInteger(capacity) ||
    capacity <= 0 ||
    !Number.isInteger(minimumCrew) ||
    minimumCrew < 0 ||
    !isNonEmptyString(initialDestination) ||
    !isNonEmptyString(finalDestination) ||
    !AIRCRAFT_STATUSES.includes(status)
  ) {
    throw new DomainError(
      'Se requieren name, registration, capacity positivo, minimum_crew no negativo, initial_destination, final_destination y un status válido.'
    );
  }

  return {
    name: name.trim(),
    registration: registration.trim().toUpperCase(),
    capacity,
    minimumCrew,
    initialDestination: initialDestination.trim(),
    finalDestination: finalDestination.trim(),
    status,
  };
}

// Solo una aeronave en operación puede programarse en un vuelo.
function canBeScheduled(aircraft) {
  return aircraft.status === 'operating';
}

module.exports = { AIRCRAFT_STATUSES, createAircraft, canBeScheduled };
