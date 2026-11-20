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

const MONTHS = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dayPattern = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function hasFlight(absence) {
  return isNonEmptyString(absence.flight_number);
}

function hasDates(absence) {
  return dayPattern.test(absence.start_date) && dayPattern.test(absence.end_date);
}

function canReceiveAlerts(user) {
  return Boolean(user) && SUPERVISOR_ROLES.includes(user.role);
}

// Las ausencias antiguas son por vuelo; las nuevas, por fechas.
function requireAbsence(absence) {
  if (
    !absence ||
    typeof absence.id !== 'string' ||
    !uuidPattern.test(absence.id) ||
    !(hasFlight(absence) || hasDates(absence))
  ) {
    throw new DomainError(
      'Se requiere una ausencia con id y flight_number o con start_date y end_date.'
    );
  }
}

function crewLabel(absence) {
  return absence.employee_code || 'Un tripulante';
}

// 'AAAA-MM-DD' → '20 nov', sin depender de la zona horaria.
function formatDay(value) {
  const [, month, day] = value.match(dayPattern);
  return `${Number(day)} ${MONTHS[Number(month) - 1]}`;
}

function datesLabel(absence) {
  return `del ${formatDay(absence.start_date)} al ${formatDay(absence.end_date)}`;
}

// Alerta: un tripulante no podrá cumplir su vuelo o trabajar esas fechas.
function createAbsenceReportedAlert(absence) {
  requireAbsence(absence);

  const reason = REASON_LABELS[absence.reason] || absence.reason;
  const message = hasFlight(absence)
    ? `${crewLabel(absence)} no podrá volar ${absence.flight_number} (${reason}).`
    : `${crewLabel(absence)} no podrá trabajar ${datesLabel(absence)} (${reason}).`;

  return {
    type: ALERT_EVENTS.absenceReported,
    message,
    absence,
    sent_at: new Date().toISOString(),
  };
}

// Alerta: una ausencia ya tiene reemplazo; sirve para actualizar la cola
// de los demás supervisores.
function createAbsenceCoveredAlert(absence) {
  requireAbsence(absence);

  const message = hasFlight(absence)
    ? `La ausencia del vuelo ${absence.flight_number} ya tiene reemplazo.`
    : `La ausencia de ${absence.employee_code || 'un tripulante'} ${datesLabel(absence)} ya tiene reemplazo.`;

  return {
    type: ALERT_EVENTS.absenceCovered,
    message,
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
