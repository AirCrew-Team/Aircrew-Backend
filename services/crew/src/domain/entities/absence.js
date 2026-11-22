const { DomainError } = require('../errors');
const { normalizeFileName } = require('../value-objects/fileName');

// illness: incapacidad · fatigue: fatiga
// emergency: calamidad · transfer: problema de traslado
const ABSENCE_REASONS = ['illness', 'fatigue', 'emergency', 'transfer'];

// Texto en español de cada motivo, para la línea de tiempo y las alertas.
const REASON_LABELS = {
  illness: 'incapacidad',
  fatigue: 'fatiga',
  emergency: 'calamidad',
  transfer: 'problema de traslado',
};

// Estado de la búsqueda de reemplazos: searching (la IA trabaja), ready
// (hay candidatos), none (nadie cumple las reglas) o error (la IA no pudo
// responder; el supervisor puede pedir otra ronda).
const SUGGESTIONS_STATES = ['searching', 'ready', 'none', 'error'];
// reported: falta reemplazo · covered: ya tiene reemplazo
// reported: falta reemplazo · pending_ack: el reemplazo aún no da «Enterado»
// covered: cubierta · cancelled: cancelada
const ABSENCE_STATUSES = ['reported', 'pending_ack', 'covered', 'cancelled'];
const MAX_NOTES_LENGTH = 500;
const MAX_ABSENCE_DAYS = 30;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_DAYS_AHEAD = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

// Primeros bytes y extensión de cada tipo de comprobante permitido.
const ATTACHMENT_TYPES = {
  'application/pdf': { signature: Buffer.from('%PDF-'), extension: '.pdf' },
  'image/png': {
    signature: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    extension: '.png',
  },
  'image/jpeg': {
    signature: Buffer.from([0xff, 0xd8, 0xff]),
    extension: '.jpg',
  },
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const base64Pattern = /^[A-Za-z0-9+/]*={0,2}$/;

// 'AAAA-MM-DD' → milisegundos UTC, o null si no es un día que exista.
function parseDay(value) {
  if (typeof value !== 'string' || !dayPattern.test(value)) {
    return null;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date.getTime()
    : null;
}

// «Hoy» va en UTC y se acepta desde ayer: margen para la zona horaria
// del tripulante. El inicio puede ser como mucho de dentro de 365 días.
function validateDates(startDate, endDate, now) {
  const start = parseDay(startDate);
  const end = parseDay(endDate);

  if (start === null || end === null) {
    throw new DomainError(
      'Las fechas de inicio y fin deben ser fechas válidas con el formato AAAA-MM-DD.'
    );
  }

  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );

  if (start < today - DAY_MS) {
    throw new DomainError('La fecha de inicio no puede ser anterior a hoy.');
  }

  if (start > today + MAX_DAYS_AHEAD * DAY_MS) {
    throw new DomainError(
      `La fecha de inicio no puede ser posterior a ${MAX_DAYS_AHEAD} días desde hoy.`
    );
  }

  if (end < start) {
    throw new DomainError(
      'La fecha de fin no puede ser anterior a la de inicio.'
    );
  }

  if ((end - start) / DAY_MS > MAX_ABSENCE_DAYS) {
    throw new DomainError(
      `No puede haber más de ${MAX_ABSENCE_DAYS} días entre la fecha de inicio y la de fin.`
    );
  }
}

// Decodifica el comprobante y comprueba tipo, tamaño y primeros bytes.
function parseAttachment(attachment) {
  const {
    file_name: fileName,
    mime_type: mimeType,
    data_base64: dataBase64,
  } = attachment;

  if (
    typeof fileName !== 'string' ||
    fileName.trim() === '' ||
    typeof mimeType !== 'string' ||
    typeof dataBase64 !== 'string' ||
    dataBase64 === ''
  ) {
    throw new DomainError(
      'El comprobante debe incluir el nombre del archivo, el tipo y el contenido.'
    );
  }

  // hasOwn: un tipo como «constructor» no debe encontrar Object.prototype.
  if (!Object.hasOwn(ATTACHMENT_TYPES, mimeType)) {
    throw new DomainError('El comprobante debe ser un PDF, PNG o JPG.');
  }

  const { signature, extension } = ATTACHMENT_TYPES[mimeType];

  if (dataBase64.length % 4 !== 0 || !base64Pattern.test(dataBase64)) {
    throw new DomainError('El contenido del comprobante no está en base64.');
  }

  const data = Buffer.from(dataBase64, 'base64');

  if (data.length > MAX_ATTACHMENT_BYTES) {
    throw new DomainError('El comprobante no puede pesar más de 10 MB.');
  }

  if (!data.subarray(0, signature.length).equals(signature)) {
    throw new DomainError(
      'El archivo no coincide con el tipo de comprobante indicado.'
    );
  }

  return {
    fileName: normalizeFileName(fileName, extension, 'comprobante'),
    mimeType,
    sizeBytes: data.length,
    data,
  };
}

// Valida y normaliza los datos de una ausencia nueva, por fechas.
function createAbsence(
  { startDate, endDate, reason, notes = null, attachment = null },
  now
) {
  validateDates(startDate, endDate, now);

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

  const file =
    attachment === null || attachment === undefined
      ? null
      : parseAttachment(attachment);

  if (reason === 'illness' && !file) {
    throw new DomainError(
      'El comprobante es obligatorio cuando el motivo es incapacidad.'
    );
  }

  return {
    startDate,
    endDate,
    reason,
    notes: notes === null || notes.trim() === '' ? null : notes.trim(),
    attachment: file,
  };
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

// Lo que informa Recommendation al terminar una búsqueda.
function validateSuggestionsUpdate({ state, candidate_count: count } = {}) {
  if (!SUGGESTIONS_STATES.includes(state)) {
    throw new DomainError(
      `state debe ser uno de: ${SUGGESTIONS_STATES.join(', ')}.`,
      400,
      { field: 'state' }
    );
  }

  if (count !== undefined && (!Number.isInteger(count) || count < 0)) {
    throw new DomainError('candidate_count debe ser un entero mayor o igual a 0.', 400, {
      field: 'candidate_count',
    });
  }

  return { state, candidateCount: count || 0 };
}

// Ausencia por vuelo: el tripulante no podrá cumplir un vuelo asignado.
function createFlightAbsence({ flightId, reason, notes = null }) {
  if (typeof flightId !== 'string' || !uuidPattern.test(flightId)) {
    throw new DomainError('Se requiere un flight_id válido.');
  }

  if (!ABSENCE_REASONS.includes(reason)) {
    throw new DomainError(`reason debe ser uno de: ${ABSENCE_REASONS.join(', ')}.`);
  }

  if (notes !== null && (typeof notes !== 'string' || notes.length > MAX_NOTES_LENGTH)) {
    throw new DomainError(`notes debe ser un texto de máximo ${MAX_NOTES_LENGTH} caracteres.`);
  }

  return {
    flightId,
    reason,
    notes: notes === null || notes.trim() === '' ? null : notes.trim(),
  };
}

// Solo se reporta ausencia en un vuelo programado o demorado que no ha salido.
function canReportAbsenceFor(flight, now = new Date()) {
  return (
    ['scheduled', 'delayed'].includes(flight.status) &&
    new Date(flight.departure_at) > now
  );
}

// Día de salida en hora de Colombia (AAAA-MM-DD).
function bogotaDay(value) {
  return new Date(new Date(value).getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Vuelos asignados que salen entre startDate y endDate (días de Colombia, incluidos)
// y todavía admiten reemplazo: cada uno será una solicitud de reemplazo.
function flightsWithinDates(assignments, startDate, endDate, now = new Date()) {
  return assignments.filter(({ flight }) => {
    const day = bogotaDay(flight.departure_at);
    return day >= startDate && day <= endDate && canReportAbsenceFor(flight, now);
  });
}

const ABSENCE_KINDS = ['flight', 'dates'];

// ?kind=flight (cola de reemplazos) o ?kind=dates. Vacío: todas.
function parseKindFilter(kind) {
  if (kind === undefined || kind === '') return null;
  if (!ABSENCE_KINDS.includes(kind)) {
    throw new DomainError(`kind debe ser uno de: ${ABSENCE_KINDS.join(', ')}.`, 400, { field: 'kind' });
  }
  return kind;
}

module.exports = {
  ABSENCE_REASONS,
  REASON_LABELS,
  SUGGESTIONS_STATES,
  validateSuggestionsUpdate,
  ABSENCE_STATUSES,
  createAbsence,
  createFlightAbsence,
  canReportAbsenceFor,
  flightsWithinDates,
  parseKindFilter,
  isValidAbsenceId,
  parseStatusFilter,
  validateCoverage,
};
