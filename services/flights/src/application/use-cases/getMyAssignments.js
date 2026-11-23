const { DomainError } = require('../../domain/errors');

const monthPattern = /^\d{4}-\d{2}$/;
const STATUSES = ['upcoming', 'completed'];

function parseBoolean(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function parseDate(value, name) {
  if (value === undefined || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new DomainError(`${name} debe ser una fecha ISO-8601.`, 400, { field: name });
  }
  return date;
}

// Vuelos del tripulante (Mis Vuelos). Filtros opcionales:
// - replacement / acknowledged: reemplazos con o sin «Enterado».
// - status: upcoming (no ha aterrizado) o completed (ya aterrizó: historial).
// - month (AAAA-MM) o from / to: por fecha de salida.
function createGetMyAssignments(assignmentRepository) {
  return async function getMyAssignments(user, query = {}) {
    const { replacement, acknowledged, status, month } = query;

    if (status !== undefined && !STATUSES.includes(status)) {
      throw new DomainError(`status debe ser uno de: ${STATUSES.join(', ')}.`, 400, { field: 'status' });
    }
    if (month !== undefined && !monthPattern.test(month)) {
      throw new DomainError('month debe tener el formato AAAA-MM.', 400, { field: 'month' });
    }
    const from = parseDate(query.from, 'from');
    const to = parseDate(query.to, 'to');

    const assignments = await assignmentRepository.findAssignmentsByCrewUser(user.id, {
      replacement: parseBoolean(replacement),
      acknowledged: parseBoolean(acknowledged),
    });

    const now = Date.now();
    return assignments.filter(({ flight }) => {
      const landed = flight.status === 'completed' || new Date(flight.arrival_at).getTime() < now;
      if (status === 'completed' && !landed) return false;
      if (status === 'upcoming' && (landed || flight.status === 'cancelled')) return false;
      if (month && new Date(flight.departure_at).toISOString().slice(0, 7) !== month) return false;
      if (from && new Date(flight.departure_at) < from) return false;
      if (to && new Date(flight.departure_at) >= to) return false;
      return true;
    });
  };
}

module.exports = createGetMyAssignments;
