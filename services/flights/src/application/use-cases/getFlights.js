const { DomainError } = require('../../domain/errors');

// Los filtros aceptan cualquier fecha ISO-8601 (por ejemplo, 2026-11-20).
function parseOptionalDate(value, name) {
  if (value === undefined || value === '') {
    return null;
  }

  const date = new Date(value);

  if (typeof value !== 'string' || Number.isNaN(date.getTime())) {
    throw new DomainError(`${name} debe ser una fecha ISO-8601.`);
  }

  return date.toISOString();
}

const { requiredSlots } = require('../../domain/entities/crewComplement');

// Cada vuelo trae sus puestos requeridos (required_slots) para la programación.
function createGetFlights(flightRepository) {
  return async function getFlights({ from, to } = {}) {
    const flights = await flightRepository.findFlights({
      from: parseOptionalDate(from, 'from'),
      to: parseOptionalDate(to, 'to'),
    });
    return flights.map((flight) => ({ ...flight, required_slots: requiredSlots(flight) }));
  };
}

module.exports = createGetFlights;
