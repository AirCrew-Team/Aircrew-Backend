const { DomainError } = require('../errors');

// illness: incapacidad · fatigue: fatiga
// emergency: calamidad · transfer: problema de traslado
const ABSENCE_REASONS = ['illness', 'fatigue', 'emergency', 'transfer'];
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

module.exports = { ABSENCE_REASONS, createAbsence, canReportAbsenceFor };
