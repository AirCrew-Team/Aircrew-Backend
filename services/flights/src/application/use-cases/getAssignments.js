const { DomainError } = require('../../domain/errors');

// 40 días: el motor pide el mes del vuelo más un día a cada lado.
const MAX_RANGE_DAYS = 40;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseRequiredDate(value, name) {
  const date = typeof value === 'string' ? new Date(value) : null;

  if (!date || Number.isNaN(date.getTime())) {
    throw new DomainError(`${name} es obligatorio y debe ser una fecha ISO-8601.`);
  }

  return date;
}

// Asignaciones activas de todos los tripulantes cuyos vuelos se cruzan con
// el rango [from, to). El motor de recomendación las usa para la regla de descanso.
function createGetAssignments(assignmentRepository) {
  return function getAssignments({ from, to } = {}) {
    const start = parseRequiredDate(from, 'from');
    const end = parseRequiredDate(to, 'to');

    if (end <= start) {
      throw new DomainError('to debe ser posterior a from.');
    }

    if (end - start > MAX_RANGE_DAYS * DAY_MS) {
      throw new DomainError(
        `El rango no puede ser mayor a ${MAX_RANGE_DAYS} días.`
      );
    }

    return assignmentRepository.findAssignmentsInRange({
      from: start.toISOString(),
      to: end.toISOString(),
    });
  };
}

module.exports = createGetAssignments;
