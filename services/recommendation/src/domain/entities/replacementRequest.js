const { DomainError } = require('../errors');

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Una ausencia `reported` es la solicitud de reemplazo.
function isValidAbsenceId(id) {
  return typeof id === 'string' && uuidPattern.test(id);
}

function isValidUserId(id) {
  return typeof id === 'string' && uuidPattern.test(id);
}

const CLOSED_MESSAGES = {
  pending_ack: ['La ausencia ya tiene un reemplazo esperando confirmación.', 'absence_pending_ack'],
  covered: ['La ausencia ya está cubierta.', 'absence_covered'],
  cancelled: ['La ausencia fue cancelada.', 'absence_cancelled'],
};

// La solicitud sigue abierta si la ausencia está `reported` y el vuelo
// todavía no ha salido.
function assertCanBeReplaced(absence, flight, now = new Date()) {
  if (CLOSED_MESSAGES[absence.status]) {
    const [message, code] = CLOSED_MESSAGES[absence.status];
    throw new DomainError(message, 409, { code });
  }

  if (
    !['scheduled', 'delayed'].includes(flight.status) ||
    new Date(flight.departure_at) <= now
  ) {
    throw new DomainError('El vuelo ya no admite reemplazos.', 409, { code: 'flight_closed' });
  }
}

const MAX_REASON_LENGTH = 300;

// Motivo opcional del supervisor al pedir otra ronda. Vacío o ausente = null.
function parseRegenerateReason(body) {
  const reason = body && body.reason;
  if (reason === undefined || reason === null) return null;
  if (typeof reason !== 'string') {
    throw new DomainError('reason debe ser texto.', 400, { code: 'invalid_reason', field: 'reason' });
  }
  const trimmed = reason.trim();
  if (trimmed.length > MAX_REASON_LENGTH) {
    throw new DomainError(`El motivo admite máximo ${MAX_REASON_LENGTH} caracteres.`, 400, {
      code: 'invalid_reason',
      field: 'reason',
    });
  }
  return trimmed || null;
}

module.exports = { isValidAbsenceId, isValidUserId, assertCanBeReplaced, parseRegenerateReason };
