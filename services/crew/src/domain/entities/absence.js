const { DomainError } = require('../errors');

// illness: incapacidad · fatigue: fatiga
// emergency: calamidad · transfer: problema de traslado
const ABSENCE_REASONS = ['illness', 'fatigue', 'emergency', 'transfer'];
// reported: falta reemplazo · covered: ya tiene reemplazo
const ABSENCE_STATUSES = ['reported', 'covered'];
const MAX_NOTES_LENGTH = 500;
const MAX_ABSENCE_DAYS = 30;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_FILE_NAME_LENGTH = 255;
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
// del tripulante.
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

  if (fileName.trim().length > MAX_FILE_NAME_LENGTH) {
    throw new DomainError(
      `El nombre del archivo puede tener máximo ${MAX_FILE_NAME_LENGTH} caracteres.`
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

  // La extensión sale del tipo comprobado, no de la que traiga el nombre:
  // así un PDF llamado «informe.html» no se descarga como HTML.
  const baseName = fileName.trim().replace(/\.[^.]*$/, '').trim();

  return {
    fileName: `${baseName || 'comprobante'}${extension}`,
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

module.exports = {
  ABSENCE_REASONS,
  ABSENCE_STATUSES,
  createAbsence,
  isValidAbsenceId,
  parseStatusFilter,
  validateCoverage,
};
