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

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDS = 200;

// ids: lista separada por comas (para pedir varios vuelos en una sola llamada).
function parseOptionalIds(value) {
  if (value === undefined || value === '') return null;
  const ids = typeof value === 'string' ? value.split(',').map((id) => id.trim()).filter(Boolean) : [];
  if (ids.length === 0 || ids.length > MAX_IDS || !ids.every((id) => uuidPattern.test(id))) {
    throw new DomainError(`ids debe ser una lista de hasta ${MAX_IDS} UUID separados por comas.`, 400, {
      field: 'ids',
    });
  }
  return [...new Set(ids)];
}

// Cada vuelo trae sus puestos requeridos (required_slots) para la programación.
function createGetFlights(flightRepository) {
  return async function getFlights({ from, to, ids } = {}) {
    const flights = await flightRepository.findFlights({
      from: parseOptionalDate(from, 'from'),
      to: parseOptionalDate(to, 'to'),
      ids: parseOptionalIds(ids),
    });
    return flights.map((flight) => ({ ...flight, required_slots: requiredSlots(flight) }));
  };
}

module.exports = createGetFlights;
