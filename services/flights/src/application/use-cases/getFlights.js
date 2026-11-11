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

function createGetFlights(flightRepository) {
  return function getFlights({ from, to } = {}) {
    return flightRepository.findFlights({
      from: parseOptionalDate(from, 'from'),
      to: parseOptionalDate(to, 'to'),
    });
  };
}

module.exports = createGetFlights;
