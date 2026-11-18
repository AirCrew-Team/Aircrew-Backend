const { DomainError } = require('../errors');

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Una ausencia `reported` es la solicitud de reemplazo.
function isValidAbsenceId(id) {
  return typeof id === 'string' && uuidPattern.test(id);
}

// La solicitud sigue abierta si la ausencia no está cubierta y el vuelo
// todavía no ha salido.
function assertCanBeReplaced(absence, flight, now = new Date()) {
  if (absence.status === 'covered') {
    throw new DomainError('La ausencia ya está cubierta.', 409);
  }

  if (
    !['scheduled', 'delayed'].includes(flight.status) ||
    new Date(flight.departure_at) <= now
  ) {
    throw new DomainError('El vuelo ya no admite reemplazos.', 409);
  }
}

module.exports = { isValidAbsenceId, assertCanBeReplaced };
