const { DomainError } = require('./errors');

// Eventos que reciben los supervisores conectados por WebSocket.
const ALERT_EVENTS = {
  absenceReported: 'absence:reported',
  absenceCovered: 'absence:covered',
};

// Solo los supervisores reciben alertas.
const SUPERVISOR_ROLES = ['supervisor', 'super_admin'];
const SUPERVISORS_ROOM = 'supervisors';

const REASON_LABELS = {
  illness: 'incapacidad',
  fatigue: 'fatiga',
  emergency: 'calamidad',
  transfer: 'problema de traslado',
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function canReceiveAlerts(user) {
  return Boolean(user) && SUPERVISOR_ROLES.includes(user.role);
}

function requireAbsence(absence) {
  if (
    !absence ||
    typeof absence.id !== 'string' ||
    !uuidPattern.test(absence.id) ||
    !isNonEmptyString(absence.flight_number)
  ) {
    throw new DomainError('Se requiere una ausencia con id y flight_number.');
  }
}

function crewLabel(absence) {
  return absence.employee_code || 'Un tripulante';
}

// Alerta: un tripulante no podrá cumplir su vuelo.
function createAbsenceReportedAlert(absence) {
  requireAbsence(absence);

  const reason = REASON_LABELS[absence.reason] || absence.reason;

  return {
    type: ALERT_EVENTS.absenceReported,
    message: `${crewLabel(absence)} no podrá volar ${absence.flight_number} (${reason}).`,
    absence,
    sent_at: new Date().toISOString(),
  };
}

// Alerta: una ausencia ya tiene reemplazo; sirve para actualizar la cola
// de los demás supervisores.
function createAbsenceCoveredAlert(absence) {
  requireAbsence(absence);

  return {
    type: ALERT_EVENTS.absenceCovered,
    message: `La ausencia del vuelo ${absence.flight_number} ya tiene reemplazo.`,
    absence,
    sent_at: new Date().toISOString(),
  };
}

module.exports = {
  ALERT_EVENTS,
  SUPERVISORS_ROOM,
  canReceiveAlerts,
  createAbsenceReportedAlert,
  createAbsenceCoveredAlert,
};
