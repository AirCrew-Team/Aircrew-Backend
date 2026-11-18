const { DomainError } = require('../errors');

// illness: incapacidad · fatigue: fatiga
// emergency: calamidad · transfer: problema de traslado
const ABSENCE_REASONS = ['illness', 'fatigue', 'emergency', 'transfer'];
// reported: falta reemplazo · covered: ya tiene reemplazo
const ABSENCE_STATUSES = ['reported', 'covered'];
const MAX_NOTES_LENGTH = 500;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Valida y normaliza los datos de una ausencia nueva.
function createAbsence({ flightId, reason, notes = null }) {
  if (typeof flightId !== 'string' || !uuidPattern.test(flightId)) {
    throw new DomainError('Se requiere un flight_id válido.');
  }

  if (!ABSENCE_REASONS.includes(reason)) {
    throw new DomainError(
      `reason debe ser uno de: ${ABSENCE_REASONS.join(', ')}.`
    );
  }

  if (
    notes !== null &&
    (typeof notes !== 'string' || notes.length > MAX_NOTES_LENGTH)
  ) {
    throw new DomainError(
      `notes debe ser un texto de máximo ${MAX_NOTES_LENGTH} caracteres.`
    );
  }

  return {
    flightId,
    reason,
    notes: notes === null || notes.trim() === '' ? null : notes.trim(),
  };
}

// Solo se reporta ausencia en un vuelo que todavía no ha salido.
function canReportAbsenceFor(flight, now = new Date()) {
  return (
    ['scheduled', 'delayed'].includes(flight.status) &&
    new Date(flight.departure_at) > now
  );
}

function isValidAbsenceId(id) {
  return typeof id === 'string' && uuidPattern.test(id);
}

// Filtro opcional de la lista de ausencias.
function parseStatusFilter(status) {
  if (status === undefined || status === '') {
    return null;
  }

  if (!ABSENCE_STATUSES.includes(status)) {
    throw new DomainError(
      `status debe ser uno de: ${ABSENCE_STATUSES.join(', ')}.`
    );
  }

  return status;
}

// Valida el reemplazo que cubre una ausencia.
function validateCoverage(absence, replacementUserId) {
  if (
    typeof replacementUserId !== 'string' ||
    !uuidPattern.test(replacementUserId)
  ) {
    throw new DomainError('Se requiere un replacement_user_id válido.');
  }

  if (replacementUserId.toLowerCase() === absence.crew_user_id.toLowerCase()) {
    throw new DomainError(
      'El reemplazo no puede ser el mismo tripulante que se ausentó.'
    );
  }

  if (absence.status === 'covered') {
    throw new DomainError('La ausencia ya está cubierta.', 409);
  }
}

module.exports = {
  ABSENCE_REASONS,
  ABSENCE_STATUSES,
  createAbsence,
  canReportAbsenceFor,
  isValidAbsenceId,
  parseStatusFilter,
  validateCoverage,
};
