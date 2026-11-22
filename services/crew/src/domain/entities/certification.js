const { DomainError } = require('../errors');

// Certificación FAA de un tripulante, que registra y verifica el super_admin:
// número de licencia, certificados y si ya se cotejó. Una por tripulante; sin
// ella, el tripulante está «sin certificado».

// Catálogo de certificados, en el orden en que se muestran.
const CERTIFICATES = Object.freeze([
  { code: 'PPL', name: 'Private Pilot (PPL)', short: 'PPL' },
  { code: 'CPL', name: 'Commercial Pilot (CPL)', short: 'CPL' },
  { code: 'ATP', name: 'Airline Transport Pilot (ATP)', short: 'ATP' },
  { code: 'IR', name: 'Instrument Rating (IR)', short: 'IR' },
  { code: 'ME', name: 'Multi-Engine (ME)', short: 'ME' },
  { code: 'CDP', name: 'Certificate of Demonstrated Proficiency (CDP)', short: 'CDP' },
  { code: 'LID', name: 'Liderazgo', short: 'Liderazgo' },
  { code: 'CONF', name: 'Manejo de conflictos', short: 'Conflictos' },
  { code: 'ADU', name: 'Aduanas / Inmigración', short: 'Aduanas' },
]);
const CERTIFICATE_ORDER = CERTIFICATES.map((certificate) => certificate.code);

// Licencias de piloto: IR y ME son habilitaciones sobre una de ellas.
const PILOT_LICENSES = ['ATP', 'CPL', 'PPL'];
// El CDP es obligatorio para la tripulación de cabina.
const CABIN_LICENSE = 'CDP';

const PILOT_CERTIFICATES = ['PPL', 'CPL', 'ATP', 'IR', 'ME'];
const PURSER_CERTIFICATES = ['CDP', 'LID', 'CONF', 'ADU'];

// Cargos del catálogo de Admin: área (cabina de mando o de pasajeros) y
// certificados que se pueden registrar.
const POSITIONS = Object.freeze({
  Comandante: { area: 'flight_deck', certificates: PILOT_CERTIFICATES },
  Copiloto: { area: 'flight_deck', certificates: PILOT_CERTIFICATES },
  'Auxiliar de Vuelo': { area: 'cabin', certificates: ['CDP'] },
  'Sobrecargo Principal': { area: 'cabin', certificates: PURSER_CERTIFICATES },
  Sobrecargo: { area: 'cabin', certificates: PURSER_CERTIFICATES },
});

// Con qué se coteja la certificación al verificarla (queda en el historial).
const VERIFICATION_NOTES = {
  flight_deck: 'cotejado con Airmen Inquiry (registro público FAA)',
  cabin: 'cotejado con el certificado físico del tripulante',
};

// verified: cotejada · pending_verification: registrada sin cotejar ·
// uncertified: el tripulante todavía no tiene certificación.
const CERTIFICATION_STATUSES = ['verified', 'pending_verification', 'uncertified'];

const LICENSE_NUMBER_PATTERN = /^\d{5,10}$/;
const DEFAULT_PAGE_SIZE = 5;
const MAX_PAGE_SIZE = 100;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidCrewUserId(id) {
  return typeof id === 'string' && uuidPattern.test(id);
}

// Datos del cargo (área y certificados posibles), o null si no es del catálogo.
function positionInfo(position) {
  return Object.hasOwn(POSITIONS, position) ? POSITIONS[position] : null;
}

function certificationStatus(certification) {
  return certification ? certification.status : 'uncertified';
}

// Valida lo que envía el super_admin al registrar o editar.
// `file`: undefined deja la copia que había, null la quita y un objeto la reemplaza
// (lo valida el value object del archivo).
function validateCertificationInput(position, input) {
  const info = positionInfo(position);

  if (!info) {
    throw new DomainError(
      'El cargo del tripulante no tiene certificados definidos: revisa su cargo en Usuarios.',
      409
    );
  }

  const { license_number: licenseNumber, certificates, verified } = input || {};

  if (typeof licenseNumber !== 'string' || !LICENSE_NUMBER_PATTERN.test(licenseNumber.trim())) {
    throw new DomainError(
      'Usa solo números (de 5 a 10 dígitos) en el número de licencia, como aparece en la tarjeta.'
    );
  }

  if (
    !Array.isArray(certificates) ||
    certificates.length === 0 ||
    !certificates.every((code) => typeof code === 'string')
  ) {
    throw new DomainError('Selecciona al menos un certificado.');
  }

  const codes = [...new Set(certificates.map((code) => code.trim().toUpperCase()))];
  const invalid = codes.filter((code) => !info.certificates.includes(code));

  if (invalid.length > 0) {
    throw new DomainError(
      `Certificados no permitidos para ${position}: ${invalid.join(', ')}. Usa: ${info.certificates.join(', ')}.`
    );
  }

  if (info.area === 'flight_deck' && !codes.some((code) => PILOT_LICENSES.includes(code))) {
    throw new DomainError('Un piloto necesita al menos una licencia: PPL, CPL o ATP.');
  }

  if (info.area === 'cabin' && !codes.includes(CABIN_LICENSE)) {
    throw new DomainError(
      'El Certificate of Demonstrated Proficiency (CDP) es obligatorio para la tripulación de cabina.'
    );
  }

  if (typeof verified !== 'boolean') {
    throw new DomainError('verified debe ser true o false.');
  }

  return {
    area: info.area,
    licenseNumber: licenseNumber.trim(),
    certificates: codes.sort(
      (a, b) => CERTIFICATE_ORDER.indexOf(a) - CERTIFICATE_ORDER.indexOf(b)
    ),
    status: verified ? 'verified' : 'pending_verification',
  };
}

// Eventos del historial que deja un guardado. Se guardan en este orden, así que
// leídos del más reciente al más antiguo queda «verificado» sobre «registrado».
function historyEventsFor(previous, next, area) {
  const events = [{ event: previous ? 'updated' : 'registered', note: null }];

  if (next.status === 'verified' && certificationStatus(previous) !== 'verified') {
    events.push({ event: 'verified', note: VERIFICATION_NOTES[area] });
  }

  return events;
}

// Sin mayúsculas ni tildes: «benitez» encuentra «Benítez».
function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

// Página, búsqueda y estado de la lista.
function parseListParams({ page, page_size: pageSize, search, status } = {}) {
  const pageNumber = page === undefined || page === '' ? 1 : Number(page);
  const size = pageSize === undefined || pageSize === '' ? DEFAULT_PAGE_SIZE : Number(pageSize);

  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw new DomainError('page debe ser un entero mayor o igual a 1.');
  }

  if (!Number.isInteger(size) || size < 1 || size > MAX_PAGE_SIZE) {
    throw new DomainError(`page_size debe ser un entero de 1 a ${MAX_PAGE_SIZE}.`);
  }

  if (status !== undefined && status !== '' && !CERTIFICATION_STATUSES.includes(status)) {
    throw new DomainError(`status debe ser uno de: ${CERTIFICATION_STATUSES.join(', ')}.`);
  }

  return {
    page: pageNumber,
    pageSize: size,
    search: typeof search === 'string' ? normalizeText(search) : '',
    status: status || null,
  };
}

// La búsqueda de la pantalla: nombre, código (ID) o número de licencia.
function matchesSearch(item, search) {
  return (
    !search ||
    [item.name, item.employee_code, item.license_number].some((value) =>
      normalizeText(value).includes(search)
    )
  );
}

// Primero lo que requiere atención: sin certificado, por verificar, verificado.
function compareForList(a, b) {
  return (
    CERTIFICATION_STATUSES.indexOf(b.status) - CERTIFICATION_STATUSES.indexOf(a.status) ||
    String(a.employee_code || '').localeCompare(String(b.employee_code || ''))
  );
}

// Nombre de cada certificado del tripulante (GET /certifications/me, que no
// puede pedir el catálogo). is_license: licencia (ATP, CPL, PPL o CDP); el
// resto son habilitaciones o cursos.
function certificateDetails(codes) {
  return codes
    .map((code) => CERTIFICATES.find((certificate) => certificate.code === code))
    .filter(Boolean)
    .map((certificate) => ({
      ...certificate,
      is_license: PILOT_LICENSES.includes(certificate.code) || certificate.code === CABIN_LICENSE,
    }));
}

// Catálogo para el formulario: certificados y los que permite cada cargo.
function certificationOptions() {
  return {
    certificates: CERTIFICATES,
    by_position: Object.fromEntries(
      Object.entries(POSITIONS).map(([position, info]) => [
        position,
        { area: info.area, certificates: info.certificates },
      ])
    ),
    pilot_licenses: PILOT_LICENSES,
    cabin_license: CABIN_LICENSE,
  };
}

module.exports = {
  CERTIFICATION_STATUSES,
  VERIFICATION_NOTES,
  isValidCrewUserId,
  positionInfo,
  certificationStatus,
  validateCertificationInput,
  historyEventsFor,
  parseListParams,
  matchesSearch,
  compareForList,
  certificationOptions,
  certificateDetails,
};
