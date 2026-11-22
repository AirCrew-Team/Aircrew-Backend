const { DomainError } = require('./errors');

// Eventos que reciben los supervisores conectados por WebSocket.
const ALERT_EVENTS = {
  absenceReported: 'absence:reported',
  absenceCovered: 'absence:covered',
  suggestionsReady: 'absence:suggestions_ready',
  deadlineMissed: 'absence:deadline_missed',
  // Solo para el tripulante afectado (sala personal).
  assignmentReplacement: 'assignment:replacement',
};

// Solo los supervisores reciben las alertas operativas.
const SUPERVISOR_ROLES = ['supervisor', 'super_admin'];
const SUPERVISORS_ROOM = 'supervisors';

// Sala personal de cada usuario, para avisos dirigidos a una sola persona.
function userRoom(userId) {
  return `user:${userId}`;
}

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
    ? absence.replacement_name
      ? `${absence.replacement_name} cubrirá el vuelo ${absence.flight_number}.`
      : `La ausencia del vuelo ${absence.flight_number} ya tiene reemplazo.`
    : `La ausencia de ${absence.employee_code || 'un tripulante'} ${datesLabel(absence)} ya tiene reemplazo.`;

  return {
    type: ALERT_EVENTS.absenceCovered,
    message,
    absence,
    sent_at: new Date().toISOString(),
  };
}

// Alerta: terminó la búsqueda de reemplazos de una ausencia.
function createSuggestionsReadyAlert(input) {
  const { absence_id: absenceId, flight_number: flightNumber, candidate_count: count, source, state } =
    input || {};

  if (typeof absenceId !== 'string' || !uuidPattern.test(absenceId) || !Number.isInteger(count)) {
    throw new DomainError('Se requieren absence_id y candidate_count.');
  }

  const flight = isNonEmptyString(flightNumber) ? ` del vuelo ${flightNumber}` : '';

  return {
    type: ALERT_EVENTS.suggestionsReady,
    message:
      state === 'error'
        ? `La IA no pudo proponer candidatos para la ausencia${flight}. Intenta de nuevo.`
        : count > 0
          ? `Hay ${count} candidato${count === 1 ? '' : 's'} para la ausencia${flight}.`
          : `Nadie cumple las reglas para cubrir la ausencia${flight}.`,
    state: state || (count > 0 ? 'ready' : 'none'),
    absence_id: absenceId,
    candidate_count: count,
    source: source || null,
    sent_at: new Date().toISOString(),
  };
}

// Alerta para supervisores: el reemplazo no confirmó a tiempo.
function createDeadlineMissedAlert(input) {
  const { absence_id: absenceId, flight_number: flightNumber, candidate_name: candidate,
    next_candidate_name: next } = input || {};

  if (typeof absenceId !== 'string' || !uuidPattern.test(absenceId)) {
    throw new DomainError('Se requiere absence_id.');
  }

  const who = isNonEmptyString(candidate) ? candidate : 'El reemplazo';
  const flight = isNonEmptyString(flightNumber) ? ` del vuelo ${flightNumber}` : '';

  return {
    type: ALERT_EVENTS.deadlineMissed,
    message: `${who} dejó vencer su plazo${flight}.${
      isNonEmptyString(next) ? ` Siguiente opción: ${next}.` : ' No quedan más candidatos.'
    }`,
    absence_id: absenceId,
    candidate_name: candidate || null,
    next_candidate_name: next || null,
    sent_at: new Date().toISOString(),
  };
}

// Aviso para el tripulante: lo asignaron como reemplazo y debe dar «Enterado».
function createAssignmentReplacementAlert(input) {
  const { crew_user_id: crewUserId, flight_number: flightNumber, deadline_at: deadlineAt,
    assignment_id: assignmentId } = input || {};

  if (typeof crewUserId !== 'string' || !uuidPattern.test(crewUserId) || !isNonEmptyString(flightNumber)) {
    throw new DomainError('Se requieren crew_user_id y flight_number.');
  }

  return {
    type: ALERT_EVENTS.assignmentReplacement,
    message: `Te asignaron como reemplazo en el vuelo ${flightNumber}. Confirma con «Enterado».`,
    crew_user_id: crewUserId,
    assignment_id: assignmentId || null,
    flight_number: flightNumber,
    deadline_at: deadlineAt || null,
    sent_at: new Date().toISOString(),
  };
}

module.exports = {
  ALERT_EVENTS,
  createDeadlineMissedAlert,
  createAssignmentReplacementAlert,
  createSuggestionsReadyAlert,
  SUPERVISORS_ROOM,
  userRoom,
  canReceiveAlerts,
  createAbsenceReportedAlert,
  createAbsenceCoveredAlert,
};
